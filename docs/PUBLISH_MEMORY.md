# Publish pipeline memory (embedder guide)

This document describes **approximate JavaScript heap use** during `@seedprotocol/publish`, so apps (especially **Electron** renderers) can stay under practical Chromium limits.

## Practical limits

Chromium/Electron renderers often cannot grow far beyond **~4 GB of JS heap** in real workloads (V8 pointer compression and platform constraints). **Raising Node or Electron memory flags does not reliably fix renderer OOM.** Design for peak heap well below that when publishing large media or many attachments.

## What dominates memory

Total **bytes being published** (all Arweave uploads in the run, summed) is the main driver. Measured in Chromium on 2026-10-29, a browser publish peaks at about **7 copies** of those bytes as ArrayBuffers in the page: the file read makes 6 short-lived copies, and the OPFS mount keeps 1 for the whole session. Signing and the batch upload come after the read's copies are freed and stay below that peak. Sending the batch as a `Uint8Array` body adds another 3–5 copies across Chromium's renderer and network processes. Saving a File value before publish (`prop.value = file; save()`) peaks at about 8 copies.

At 100 MB that is about 0.74 GB in the page during publish. A 1 GB publish fails reading the file from OPFS (`NotReadableError`) even with memory to spare.

The upload API also aborts a batch POST after 120 s, for all of a publish's uploads together: about 150 MB at 10 Mbit/s, 75 MB at 5 Mbit/s. Turbo uploads (`payment: { storage: 'user' }`) have no such timeout.

## Upload size limits

Publish checks the summed upload size in its `checking` step, from file sizes alone, before it registers EAS schemas or reads a file:

- Over `maxUploadBytes` (default 100 MiB) it fails with `UploadTooLargeError` (`uploadBytes`, `maxUploadBytes`, `estimate`).
- Over `confirmUploadAboveBytes` (default 25 MiB), or when 7 × the upload bytes is over a quarter of `navigator.deviceMemory`, it fails with `UploadNeedsConfirmError` (`estimate`) unless the publish was given `confirmUpload: true`.

`item.publish()` rejects with these errors themselves. Set the limits in `initPublish` (`maxUploadBytes`, `confirmUploadAboveBytes`, `uplinkBitsPerSecond`) or per publish (`maxUploadBytes`, `confirmUpload`). `Infinity` turns a limit off.

```typescript
try {
  await item.publish()
} catch (error) {
  if (!(error instanceof UploadNeedsConfirmError)) throw error
  const { uploadBytes, uploadSeconds, memory } = error.estimate
  if (await askUser({ uploadBytes, uploadSeconds, memory })) await item.publish({ confirmUpload: true })
}
```

To ask before the user presses Publish, `estimatePublishCost(item)` (and `usePublishCostEstimate`) returns the same numbers in `upload`, beside the storage cost:

| Field | Meaning |
|---|---|
| `uploadBytes`, `uploadCount`, `largestUploadBytes` | From file sizes; no file is read. |
| `uploadSeconds` | At `uplinkBitsPerSecond` (default 5 Mbit/s). |
| `memory.peakBytes` | 7 × `uploadBytes`. |
| `memory.deviceMemoryBytes` | `navigator.deviceMemory`: Chromium only, rounded to a power of two and capped by the browser. Absent in Safari, Firefox and Node. |
| `memory.risk` | `high` over a quarter of device memory, `unknown` without it. |
| `tooLarge`, `requiresConfirm` | What publish will do with the current limits. |

## Paths and relative cost

| Path | Notes |
|------|--------|
| **`dataItemSigner`** | Signs and batch-uploads in the same process as the publish machine. **Highest renderer peak** for large content. |
| **`signDataItems`** | Your callback typically signs/uploads via a wallet/extension; the package may skip the batch upload step when there are no `signedDataItems`. Peak depends on whether your callback holds full buffers in memory. |

When **Html embedded images** are materialized (`htmlEmbeddedDataUriPolicy` / defaults), publish runs **two sequential phases** (images + other files, then Html after rewrite). Peak memory is dominated by **one phase’s** packed batch at a time, not both simultaneously—but **`signDataItems` runs twice**, so wallet/extension flows should expect two back-to-back batches.

## `publishMode`

- **`patch`** — Only pending properties on the current version are uploaded. Fewer DataItems → lower peak for the same item over time.
- **`new_version`** — Full snapshot semantics: more properties/uploads per run → **higher** peak memory and time.

## Persistence

Publish snapshots saved to the app DB **omit** large binary fields (`signedDataItems`, legacy `arweaveUploadData`) so periodic saves do not write gigabytes to SQLite. **Do not assume** raw upload bytes can be resumed from a persisted snapshot alone; recovery paths rely on transaction ids and re-fetching item state as designed by the package.

## Related

- Bundler setup: [packages/publish/README.md](../packages/publish/README.md) (experimental Arweave bundler section).
