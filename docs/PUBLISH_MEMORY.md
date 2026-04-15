# Publish pipeline memory (embedder guide)

This document describes **approximate JavaScript heap use** during `@seedprotocol/publish`, so apps (especially **Electron** renderers) can stay under practical Chromium limits.

## Practical limits

Chromium/Electron renderers often cannot grow far beyond **~4 GB of JS heap** in real workloads (V8 pointer compression and platform constraints). **Raising Node or Electron memory flags does not reliably fix renderer OOM.** Design for peak heap well below that when publishing large media or many attachments.

## What dominates memory

Total **bytes being published** (all Arweave uploads in the run) is the main driver. Additional factors:

1. **Signed DataItems** — The bundler path builds ANS-104 binaries; each item holds payload plus signatures/tags (similar order of magnitude to the source file per item).
2. **Batch upload body** — The client packs all DataItems into **one** `application/octet-stream` body for `POST …/api/upload/arweave/batch`. Peak heap includes that buffer for the duration of the request (plus one item’s worth of transient copies during packing, depending on path).
3. **SDK / Item graph** — The live `Item`, properties, and publish helpers add overhead unrelated to raw file size but usually smaller than multi‑gigabyte uploads.

Very roughly, for **`useArweaveBundler: true`** with in-process **`dataItemSigner`**, expect a **short-lived multiple** of the total payload size (signed items + packed batch + app overhead), not a single copy.

## Paths and relative cost

| Path | Notes |
|------|--------|
| **`dataItemSigner` + bundler** | Signs and batch-uploads in the same process as the publish machine. **Highest renderer peak** for large content. |
| **`signDataItems` + bundler** | Your callback typically signs/uploads via a wallet/extension; the package may skip the batch upload step when there are no `signedDataItems`. Peak depends on whether your callback holds full buffers in memory. |

When **Html embedded images** are materialized (`htmlEmbeddedDataUriPolicy` / defaults), the bundler path runs **two sequential phases** (images + other files, then Html after rewrite). Peak memory is dominated by **one phase’s** packed batch at a time, not both simultaneously—but **`signDataItems` runs twice**, so wallet/extension flows should expect two back-to-back batches.

Non-bundler flows (reimbursement + chunked L1 upload) have a different profile; they still materialize upload data during transaction creation but do not build the same monolithic batch body.

## `publishMode`

- **`patch`** — Only pending properties on the current version are uploaded. Fewer DataItems → lower peak for the same item over time.
- **`new_version`** — Full snapshot semantics: more properties/uploads per run → **higher** peak memory and time.

## Persistence

Publish snapshots saved to the app DB **omit** large binary fields (`signedDataItems`, legacy `arweaveUploadData`) so periodic saves do not write gigabytes to SQLite. **Do not assume** raw upload bytes can be resumed from a persisted snapshot alone; recovery paths rely on transaction ids and re-fetching item state as designed by the package.

## Related

- Bundler setup: [packages/publish/README.md](../packages/publish/README.md) (experimental Arweave bundler section).
