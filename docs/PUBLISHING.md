# Publishing

This guide covers the publish flow, schema setup, **publish modes** (incremental vs new Version), reading canonical values from EAS, and related APIs.

## Concepts: Seed, Version, and property attestations

- **Seed attestation** — Identifies the item (model type, etc.) on-chain.
- **Version attestation** — References the Seed (`refUID` = Seed UID). A Seed can have **many** Version attestations over time.
- **Property attestations** — Each encodes one field value; `refUID` is the **Version** UID they belong to.

You can publish **incremental** property updates on the **same** Version (patch mode), or create a **new** Version and re-attest properties so a full snapshot points at that Version (`new_version` mode).

## Publish flow (recommended)

When using the publish package (`@seedprotocol/publish`) with `ConnectButton` and its publish flow:

1. **ensureEasSchemasForItem** runs before `getPublishPayload`. It:
   - Registers EAS schemas for each item property via the SchemaRegistry contract
   - Adds naming attestations so EASSCAN displays schemas with friendly names
   - Populates the SDK's schema map so `getPublishPayload` can resolve schema UIDs

2. **getPublishPayload** builds the attestation payload for the item and any related seeds.

3. The payload is sent to the publish contract (or direct EAS, depending on config).

You do not need to run schema setup yourself when using this flow.

## Publish modes: `patch` vs `new_version`

Control this with **`publishMode`** when building payloads or starting publish.

| Mode | Behavior |
|------|------------|
| **`patch`** (default) | Only **pending** property changes (local edits not yet attested) are included. New property attestations use the **existing** Version UID. No new Version attestation. |
| **`new_version`** | Requires the item to already have a published **Seed** (`seedUid`). Forces a **new Version** attestation (referencing the same Seed), then emits property attestations for **all** publishable fields that have values, each referencing the **new** Version. Use for a deliberate “release” or full snapshot. |

### APIs

- **`Item.getPublishPayload(uploadedTransactions, { publishMode })`** — `publishMode` is optional; default is `patch`.
- **`@seedprotocol/publish`**: pass **`publishMode`** in **`CreatePublishOptions`** to **`PublishManager.createPublish`**, **`ensureSmartWalletThenPublish`**, etc.
- Optional UI: **`PublishModeButtons`** in `@seedprotocol/publish` for “Publish updates” vs “New version”.

### Validation

- **`new_version`** without a published Seed fails validation.
- **`new_version`** with **no** property attestations on the root item fails validation (you cannot mint an empty Version snapshot through this path).

### Limitations

- **`new_version`** only includes properties that have a **publishable value** in the payload pipeline (same rules as patch). Optional fields that are empty are still skipped; filling “every column” from DB for empty fields is not automatic.
- **`patch`** relies on local metadata: edited properties get new rows without an attestation `uid` until published.

## Pending changes (diff UI)

Use **`getPublishPendingDiff`** from `@seedprotocol/sdk` with `{ seedLocalId }` / `{ seedUid }` or an **`Item`**. It returns:

- **`pendingProperties`** — Properties whose latest local row has no attestation `uid` (unpublished edits), with optional **`previousPublishedValue`** when an older attested row exists. “Latest” here is ordered by `COALESCE(attestation_created_at, created_at)` descending, then by `local_id` descending so ties are deterministic.
- **`lastPublishedVersionUid`** / **`lastVersionPublishedAt`** — From the local `versions` table when available.

Use this to show “what will publish” or badges before calling publish.

## Reading canonical values from EAS

**Rule:** For the same **Version** (`refUID`) and **schema** (`schemaId`), if multiple property attestations exist (e.g. after patch updates), the **canonical** value is the **newest** non-revoked attestation by **`timeCreated`**.

- **`getItemPropertiesFromEas`** returns **all** matching rows (may include duplicates per schema).
- Prefer **`getCanonicalItemPropertiesFromEas`** (same arguments as `getItemPropertiesFromEas`) for app/display code — it returns one attestation per `(refUID, schemaId)`.
- Alternatively, call **`pickLatestPropertyAttestationsByRefAndSchema`** on the result of `getItemPropertiesFromEas`.

Local DB reads typically resolve “latest per property” via metadata ordering; EAS-only code paths should use the canonical helpers above.

## EAS sync and local database

When the SDK syncs from EAS into SQLite, property rows are deduplicated to **canonical** attestations per Version/schema before insert, so the DB does not accumulate redundant rows for the same logical field from incremental publishes. If you need full attestation history, rely on chain indexers or archive queries rather than assuming every historical UID is stored locally.

## Verification after publish

The publish package’s verification step checks that each **expected schema** in the publish request appears on EAS for the target **Version** UID (after indexing). It does not require a specific attestation UID beyond schema presence.

## Arweave upload tags

Optional metadata tags (e.g. `App-Name`) are merged into each Arweave upload **after** `Content-SHA-256` and `Content-Type`.

### With `@seedprotocol/publish`

- Set **`arweaveUploadTags`** on **`initPublish` / `PublishProvider` config** for app-wide defaults.
- Pass **`arweaveUploadTags`** in **`CreatePublishOptions`** when calling **`PublishManager.createPublish`** (or equivalent) for tags that apply only to that run.

**Merge order:** `[...config.arweaveUploadTags, ...createPublishOptions.arweaveUploadTags]` — Seed content tags always come first, then config, then per-publish.

**Bundler path (`useArweaveBundler`):** each entry in **`signDataItems`** includes **`upload.tags`**, the full list to attach when building the DataItem. Use that array rather than re-deriving tags from hash/type alone.

**Direct SDK:** call **`item.getPublishUploads({ arweaveUploadTags: [...] })`** or import **`getPublishUploads`** with the same options object. The legacy **`runPublish`** path does not read publish config; it still calls **`getPublishUploads`** without extra tags unless you extend that flow.

Very large tag sets can exceed Arweave limits and fail at transaction or DataItem creation.

## Custom publish flows

If you call `item.getPublishPayload(uploadedTransactions)` directly (without the publish package):

- You **must** ensure EAS schemas exist and have naming attestations before calling.
- The publish package's `ensureEasSchemasForItem` handles this when using its flow.
- For custom flows: run schema setup (register schemas + add naming attestations) before `getPublishPayload`, or integrate with the publish package's flow.

## Schema setup

EAS schemas must be:

1. **Registered** on-chain via the SchemaRegistry contract
2. **Named** via a naming attestation (Schema #1) so EASSCAN displays them

If a schema is registered but has no naming attestation, attestations will work but EASSCAN will not show a friendly name. The publish package's `ensureEasSchemasForItem` handles both steps.

## Revoking (Unpublishing)

To revoke attestations and remove an item from feeds and discovery, call `item.unpublish()`. Revocation is permanent; see [ATTESTATION_REVOCATION.md](./ATTESTATION_REVOCATION.md) for permanence, UX guidance, and republishing.
