# Publishing

This guide covers the publish flow, schema setup, **publish modes** (incremental vs new Version), reading canonical values from EAS, and related APIs.

## Concepts: Seed, Version, and property attestations

- **Seed attestation** — Identifies the item (model type, etc.) on-chain.
- **Version attestation** — References the Seed (`refUID` = Seed UID). A Seed can have **many** Version attestations over time.
- **Property attestations** — Each encodes one field value; `refUID` is the **Version** UID they belong to.

You can publish **incremental** property updates on the **same** Version (patch mode), or create a **new** Version and re-attest properties so a full snapshot points at that Version (`new_version` mode).

## Publish flow (recommended)

Publishing needs the publish package (`@seedprotocol/publish`). The SDK prepares payloads but
does not upload or attest on its own: `item.publish(options)` hands the item to the executor
that `initPublish()` / `<PublishProvider config>` registers (`setPublishExecutor(publishItem)`),
and throws if none is registered. It resolves when the publish has finished and rejects if it
failed; attestation failures that wait for `PublishManager.retryAttestations` also reject, see
[Interrupted publishes](#interrupted-publishes).
`options` are the publish package's `CreatePublishOptions`.

When using the publish package with `ConnectButton` and its publish flow:

1. **ensureEasSchemasForItem** runs before `getPublishPayload`. It:
   - Registers the EAS schemas the publish attests under via the SchemaRegistry contract: each seed's model, the properties with a value (or an empty value that removes an earlier attestation), and `string storage_transaction_id` for a seed that uploads a file
   - Adds naming attestations so EASSCAN displays schemas with friendly names
   - Populates the SDK's schema map so `getPublishPayload` can resolve schema UIDs

2. **getPublishPayload** builds the attestation payload for the item and any related seeds.

   **Related drafts.** A publish carries along every draft item (no seed uid yet) reachable from the
   item through relation and list properties, at any depth, each with its full property set (its own
   relations, lists, files and Html-embedded images included). Already-published targets are
   attested by their current seed uid and not published again; a revoked target anywhere in the graph
   stops the publish with `RelatedItemUnpublishedError`. The graph is read once from the local rows
   (`getPublishGraph`): each seed's model definitions and the current row of each property, after
   pending edits are written. The payload, uploads (`getPublishUploads`, the publish package's
   `getPublishUploadData`), `summarizePublishWork`, `summarizePublishUploads`, the Html passes and
   `ensureEasSchemasForItem` read that graph; none of them reads a loaded Item. In a cycle (A ↔ B, or a draft pointing back at the draft
   being published), a publish through the contract attests both sides, since the contract creates
   every seed of a transaction first (`getPublishPayload` option `backReferences: 'link'`); a cycle
   always goes out in one transaction, as step 3 describes. Direct EAS can only attest
   the uid of a seed created before the item, so there the reference back to the item still being
   walked is left out of this publish (`'defer'`, the default); it keeps no attestation uid, and the
   next publish of its item attests it with the target's uid.

3. The payload is sent to the publish contract (or direct EAS, depending on config).
   Direct EAS is used with `useDirectEas`, or when the publisher is an EOA (no bytecode). It
   attests one transaction per Seed and records each Seed as soon as it is attested. A smart
   account that is not deployed yet is refused rather than sent down this path: deploy it first,
   then publish.

   The publish contract takes a payload in one `multiPublish` transaction. It creates every Seed and
   Version first, then writes each new Seed uid into the properties that reference it
   (`propertiesToUpdate`: a relation, or one element of a list), then attests the properties.
   Before sending, `encodeMultiPublish` puts a placeholder in each of those slots and refuses a
   payload the contract would revert on, or one that still attests a draft's local id that no
   reference fills.

   A payload too large for one transaction goes out in several, in the same publish
   ([ADR 0036](adr/0036-a-publish-splits-across-transactions.md)). The requests are grouped into
   units: one request, or every request of one cycle of references, which is never split. Units
   keep the payload's referenced-first order, so a part only references parts sent before it. Each
   part is the longest run of leading units whose local gas estimate, with 30% headroom, is under
   `maxPublishGas` and whose calldata is under 120,000 bytes, shortened by bisection until the RPC
   gas estimate from the sending account, with the same headroom, is under the lower of
   `maxPublishGas` and the block gas limit. When that estimate can't be made the part is sent as
   it is. A reference from a part to a later one is dropped from the earlier part's request.

   Once a part is recorded (step 4), its Seeds are published, so the payload is built again from
   the rows: it holds only what is left, and the relation slots of later parts hold the recorded
   Seed uids. The publish ends when the part holding the item has been recorded. An edit saved
   between parts to an item no part has sent yet goes out with it. An edit to an item an earlier
   part published waits until that item is published itself, since the payload doesn't include a
   published related item. Between parts a reader sees the earlier parts' Seeds
   published and the item not yet; if a part fails, those Seeds stay published and a retry, a
   restore or a new publish carries on with what is left. `snapshot.context.expectedPublishTransactions`
   says, after `checking`, how many parts the local estimate expects; the RPC estimates can raise
   it. `ManagedAccountPublishError` with code `PUBLISH_TOO_LARGE` now means one item, or one cycle,
   is too large for a transaction on its own; `checking` refuses it before anything is uploaded.

   Direct EAS attests requests in order, so a link must target its own request or a later one; it
   refuses a payload that doesn't (`ManagedAccountPublishError`, `PUBLISH_PREFLIGHT_FAILED`) before
   sending any attestation. `getPublishPayload` orders requests referenced-first, so its payloads
   never do this.

4. **Local recording.** Each request records its own seed, version and property attestation uids
   (`updateVersionUid`, `applyPropertyAttestationUidsFromPublish`). A request names the version row
   it was built from (`versionLocalId`) and each attestation the metadata row its value was read
   from (`_metadataLocalId`); recording updates exactly those rows, so an edit saved while the
   publish ran stays a pending draft. A relation or list-of-relation value that named seeds
   by local id is recorded as attested, the way an EAS sync stores it: the seed uid (relation) or a
   JSON array of seed uids in slot order (list, on its `<singular><Ref>Ids` row). The related seeds
   get their uids too, so local ids keep resolving to the same items.

You do not need to run schema setup yourself when using this flow.

## Domain ownership (tool sidecar)

To prove DNS control of a domain and seal a tool-attested EAS claim, see **[DOMAIN_OWNERSHIP.md](./DOMAIN_OWNERSHIP.md)** (`createDomainOwnershipChallenge` → TXT → `verifyAndAttestDomainOwnership`). That flow is separate from Seed/Version publish.

## Wallets

[PUBLISH_WALLETS.md](./PUBLISH_WALLETS.md) covers the wallet adapters, who sends each transaction, and using a ManagedAccount with your own bundler and paymaster.

## Publish automation (ManagedAccount grants)

To let an app publish/revoke on a user’s behalf with a revocable session key (without taking the user’s root key), see **[PUBLISH_AUTOMATION.md](./PUBLISH_AUTOMATION.md)**.

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

- **`new_version`** only includes properties that have a **publishable value** in the payload pipeline (same rules as patch). An empty property is skipped unless it was attested before, in which case its removal is attested (see [Clearing a property](#clearing-a-property)); filling “every column” from DB for empty fields is not automatic.
- **`patch`** relies on local metadata: edited properties get new rows without an attestation `uid` until published.

## Pending changes (diff UI)

Use **`getPublishPendingDiff`** from `@seedprotocol/sdk` with `{ seedLocalId }` / `{ seedUid }` or an **`Item`**. It returns:

- **`pendingProperties`** — Properties whose latest local row has no attestation `uid` (unpublished edits), with optional **`previousPublishedValue`** when an older attested row exists, and a **`change`**: `'set'`, `'removed'` or `'retracted'`. An empty value with nothing on chain to remove is not listed, and neither is a value equal to the last published one: relations compare by the seed they name (a local id equals the seed's uid), lists member by member in order. “Latest” here is ordered by `COALESCE(attestation_created_at, created_at)` descending, then by `local_id` descending so ties are deterministic.
- **`lastPublishedVersionUid`** / **`lastVersionPublishedAt`** — From the local `versions` table when available.

An edit back to the published value leaves no draft: when the outbox applies it, the property's drafts are deleted and its attested row is current again, so publish leaves it out too ([ADR 0019](./adr/0019-item-writes-through-an-outbox.md)). The comparison is with the latest attested value, so after sync has stored a newer value, going back to the old one is still an edit. Publish records a version uid and its property uids in one transaction, before it reports success, so a read never sees the version published while its properties are not.

Use this to show “what will publish” or badges before calling publish.

## Clearing a property

`await property.clear()` removes a property's value and `await property.clear({ retract: true })` retracts it ([ADR 0021](./adr/0021-clearing-a-property.md)). Both show the property empty at once and resolve when the cleared row is stored. `setValue(null)` and `setValue('')` on an Image, File or Html property clear it too. The old image seed and file stay on the device, as when an image is replaced.

A **removal** publishes as an attestation of the EAS type's empty value, in `patch` and `new_version` mode: `''` for Text and Number, a zero `bytes32` for Image, File, Html, Json and Relation, `[]` for List. The property's history shows the removal, reads pinned to an earlier Version still see the old value, and assigning the old value again restores it. A property that was never attested publishes nothing.

A **retraction** attests nothing. After the attestations, Publish revokes every live attestation of the property on the Version of its newest live one (the current Version, unless the property was attested only on an earlier one), and every live attestation of it on other Versions that holds one of those values, from the seed's attester (state `revokingRetractedProperties`). An EOA publisher signs that as a second transaction. Reads of earlier Versions then stop showing the value. Revocation is permanent. A failed revocation leaves the publish in `retractionFailureRecoverable` (send `retry`), and the next Publish sends whatever is still live. Publish fails in `checking`, before attesting, when the wallet can't revoke: an automation session key, or a seed attested by the executor module.

Boolean and Date have no empty value. `clear()` without `retract` rejects with `ClearNotSupportedError`, and a published Boolean or Date with an empty draft fails publish validation with `publish_clear_unsupported`.

`summarizePublishWork` counts removals in `attestationCount` and retracted attestations in `revocationCount`. `getPendingRetractions({ seedLocalId, seedUid })` lists each retracted property and the attestations publish revokes for it.

Readers treat both as absent: query leaves the property out of the seed, EAS sync stores it with no value, and local reads show no value.

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

## Interrupted publishes

Each attestation transaction commits a row to `publish_attempts` before it is sent, so a lost receipt,
a closed tab or a crash can't lead to a second send ([ADR 0030](adr/0030-attestation-sends-are-journaled.md)).
A row is open until it is recorded, reverted, or an error proves nothing went out. While one is open, a
send covering any seed in its requests fails with `AttestationAttemptOpenError` (code
`ATTESTATION_ATTEMPT_OPEN`), including a new
Publish and a publish of a related item alone. This also means a publish needs its database: with none,
the send is refused.

`PublishManager.retryAttestations(seedLocalId)` and a restored publish enter `reconcilingAttestations`
before anything can send:

| What it finds | What happens |
| --- | --- |
| Transaction landed | Recorded, nothing sent, and the publish carries on |
| Transaction reverted | The attempt closes and the publish sends again |
| UserOp with a pinned nonce that hasn't landed, in the run that sent it | Sent again under the same nonce, so only one can land |
| Anything else: no hash saved, no receipt, or another run's unlanded UserOp | Stops at `attestationOutcomeUnknown` |

`createManagedAccountTxSender`, `createPermissionlessTxSender` and the managed wallet from
`getManagedAccountWallet` pin the nonce, so a retry of the same run settles without a hash unless the
chain can't be read. A new run that meets another run's unlanded UserOp stops at
`attestationOutcomeUnknown`, because it doesn't have the same requests to send under that nonce. A custom `SeedTxSender` pins by setting `pinsNonceOn` and honouring
`SeedTxRequest.nonceKey`. Other senders, EOAs and browser wallets included, can stop there whenever the
hash was lost. A tab closed during a wallet prompt does this even if the author never signed.

The nonce key comes from the attempt, so it covers tries that share a database and an item. A host
whose tries don't, such as a server job that creates a new item per try, passes its own id as
`CreatePublishOptions.nonceKey`; see [Tries that don't share a database](PUBLISH_AUTOMATION.md#tries-that-dont-share-a-database).

A publish split across transactions (step 3 of the [publish flow](#publish-flow-recommended)) sends
each part as its own attempt, so each part has its own row and its own nonce key, and a part's
attempt is recorded before the next part claims one. A retry or restore that finds a part landed
records it and sends the rest. With a host `nonceKey`, the number of parts already sent is read from
the publish's recorded attempts, so a tab that reloads between parts goes on under the next part's
key. Each part clears its Seeds' co-publish rows as it records. The `createAttestations` output
(`easPayload`, and `publishedBatch` in the context) holds the parts the finishing try recorded; a
publish that went on from parts recorded by an earlier try leaves those out.

Show `attestationOutcomeUnknown` to the author, since Publishing again is refused until it settles.
`describePublishRun` gives it `awaitingRetry: true`, `item.publish` rejects, and
`snapshot.context.error` is an `AttestationOutcomeUnknownError` (code `ATTESTATION_OUTCOME_UNKNOWN`)
with `attemptId`, `transactionHash` and `reason`: `pinnedNotLanded` (another run's pinned UserOp
hasn't landed), `noEvidence` (no hash and no pin) or `chainUnreadable` (the receipt, the nonce or the
UserOp logs couldn't be read).
`retryAttestations` looks again and never sends blind. To settle it:

```typescript
// The author found the transaction: read and record it
await PublishManager.resolveAttestationAttempt(seedLocalId, { txHash })

// Give the attempt up and send again. If it did land, this attests a second time.
await PublishManager.resolveAttestationAttempt(seedLocalId, { resend: true })
```

`resolveAttestationAttempt` retries only a publish that runs in this tab. With no run it updates the
attempt, and the next publish reconciles from it.

To settle a seed's open attempts with no run, after a reload for example, call
`PublishManager.settleAttestationAttempt(seedLocalId, publisherAddress)`. It reads the chain as a retry
does, records a landed transaction with `publisherAddress` on its rows, closes a reverted one, and never
sends. It resolves `{ status: 'settled' }` once no attempt is open, `{ status: 'unknown', attempt, reason }`
for one it can't settle (with the same `reason` values as above), or `{ status: 'running' }` without
reading anything while a publish of the seed runs or waits in this tab, or another tab holds its lock;
`retryAttestations` settles it there. It waits for `PublishManager.ready()` first, so a publish that
restore brings back counts as running.

A publish waiting in `attestationFailureRecoverable`, `attestationFailureRecoverableDirectToEas` or
`attestationOutcomeUnknown` ends with `PublishManager.giveUpPublish(seedLocalId)`. It goes to `failure`
with its error kept, so the row reads `failed` with `errorCode`, where `stopPublish` records
`interrupted` and clears the error. While an attempt is open it doesn't end: it passes through
`checkingGiveUp` and goes back to the state it came from, since a send that may still land must not be
hidden. It then logs a warning naming the open attempt and what settles it. From
`attestationOutcomeUnknown` that is `resolveAttestationAttempt` with the transaction hash, or
`{ resend: true }`, which sends again; `settleAttestationAttempt` refuses while the run waits. From the
other two states, `retryAttestations` settles the attempt and a second `giveUpPublish` ends the run.
Read `PublishManager.query(seedLocalId)` to see which happened. A publish saved during that check is
restored in the state it came from.

Nothing goes to `failure` on its own. `isRepeatingAttestationError(error)` is true for errors that come
back on every retry until something outside the publish changes: `PublishNonceKeyError`,
`PublishChainConfigError`, and `ManagedAccountPublishError` with `PUBLISH_PREFLIGHT_FAILED`,
`PUBLISH_TOO_LARGE`, `MULTI_PUBLISH_NOT_ROUTED`, `USEROP_REVERTED`, `USEROP_FAILED_NO_REASON`,
`MANAGED_ACCOUNT_NOT_DEPLOYED` or `EXECUTOR_MODULE_NOT_INSTALLED`. A host can offer giving up first for
these. A retry can still succeed after the author deploys the account, installs the module or adds
funds.

Publishing a seed whose publish waits in `attestationFailureRecoverable` or
`attestationFailureRecoverableDirectToEas` in this tab, with no open attempt, replaces that publish:
it is stopped and recorded `interrupted`, as `stopPublish` does, and the new publish starts. The new
publish reuses an upload of the old one when its property and content hash match and the blob store
still holds it; anything else, such as a file edited since, uploads again. It also takes the old
publish's `nonceKey`, unless the host passes its own, and with it the parts sent under that key, so a
split publish sends its next part under the next part's key. A different key, or none, starts at
part 1. If the old publish was retried after Publish found it waiting, it keeps running and Publish
gives `already_publishing`. A Publish sent while restore is running waits for it, so a waiting
publish that restore brings back is replaced too. While an attempt for the seed is open, in any
state, Publishing again starts nothing: `startPublish` and `ensureWalletThenPublish` return
`{ outcome: 'attempt_open' }`, `item.publish` rejects naming `retryAttestations`, and
`PublishManager.createPublish` resolves `undefined`. Settle the attempt with `retryAttestations`,
`settleAttestationAttempt` or `resolveAttestationAttempt` first. `PublishManager.publishBlocker(seedLocalId)`
says which applies: `'none'`, `'running'`, `'parked'`, `'attempt_open'`, or, for a publish another tab
holds, `'parked_in_other_tab'` or `'running_in_other_tab'`. A publish in any other
state still gives `already_publishing`, as does one another tab runs. A publish another tab holds
parked after a failed attestation gives `{ outcome: 'parked_in_other_tab' }` and `item.publish` rejects
saying so; retry it in that tab.

Restoring in-progress publishes is reported, since a publish that wasn't restored has no process to
retry. `PublishManager.getRestoreStatus()` returns `outcome`, one of `pending`, `restored`, `dbNotReady`
or `failed`, and `onRestoreStatus(listener)` calls back when it changes. `dbNotReady` restores by itself
when the database arrives. `failed` holds `error` and isn't tried again until the next load.
`unreadableSeedLocalIds` lists saved publishes that couldn't be parsed; their rows stay `in_progress`.

A publish whose tab closes doesn't wait for a reload: an open tab of the app takes it over and
resumes it the same way, with that tab's wallet. See [Multiple tabs](MULTI_TAB.md).

## Arweave upload tags

Optional metadata tags (e.g. `App-Name`) are merged into each Arweave upload **after** `Content-SHA-256` and `Content-Type`.

Both publish paths (L1 transactions via `getPublishUploads`, bundler DataItems via `getPublishUploadData`) build uploads with the SDK's `getPublishUploadData`, so they upload the same bytes with the same tags. **`Content-SHA-256`** is the lowercase hex **SHA-256** of the uploaded bytes (`getContentSha256`). SDK 0.7.2 and earlier wrote a SHA3-256 digest under that tag on the L1 transaction path; to check a tag value read from Arweave against bytes, use `contentSha256TagMatches`, which accepts both. During files download the SDK looks up these tags in one batched GraphQL request and verifies the downloaded bytes against them: a gateway serving bytes that don't match is skipped for the next one, a transaction no gateway serves matching bytes for is not saved (and is retried on a later run), and only a verified value is copied into `metadata.content_hash`. A transaction without the tag (older uploads, or one not indexed yet) is downloaded unverified.

### With `@seedprotocol/publish`

- Set **`arweaveUploadTags`** on **`initPublish` / `PublishProvider` config** for app-wide defaults.
- Pass **`arweaveUploadTags`** in **`CreatePublishOptions`** when calling **`PublishManager.createPublish`** (or equivalent) for tags that apply only to that run.

**Merge order:** `[...config.arweaveUploadTags, ...createPublishOptions.arweaveUploadTags]` — Seed content tags always come first, then config, then per-publish.

**`signDataItems`:** each entry includes **`upload.tags`**, the full list to attach when building the DataItem. Use that array rather than re-deriving tags from hash/type alone.

**Direct SDK:** call **`item.getPublishUploads({ arweaveUploadTags: [...] })`** or import **`getPublishUploads`** with the same options object. The legacy **`runPublish`** path does not read publish config; it still calls **`getPublishUploads`** without extra tags unless you extend that flow.

Very large tag sets can exceed Arweave limits and fail at transaction or DataItem creation.

## Html: embedded images and property references

Publish uploads an item's Html in two phases when the Html points at files published with it:
phase 1 uploads everything else, the Html files are rewritten on disk with the resulting Arweave
gateway URLs, then phase 2 uploads the Html.

- **`data:image/...;base64,...` in `<img src>`** (policy `materialize`, the default): each image
  becomes an Image seed uploaded in phase 1, and its `src` is rewritten to its URL. Until the
  upload, the image's bytes are kept in the images folder as `<seed local id>.<extension>`. Policy
  `preserve` leaves data URIs in place.
- **`seed:property/<name>`** as the whole value of a `src`, `href` or `poster` attribute: the URL of
  the same item's `<name>` property, which must be an Image, File or Json property (or a relation
  to one) with a value. It becomes the URL of that property's phase-1 upload, or, when the property's
  file is not uploaded in this publish, of the transaction it was published with. This lets Html show
  a file published alongside it without embedding it a second time:

  ```html
  <img class="u-featured" src="seed:property/featureImage">
  ```

  A placeholder naming a missing, non-storage or empty property fails the publish before anything
  is uploaded (`HtmlSeedPropertyRefError`). Placeholders are resolved under either data URI policy.

The rewrite changes only those attribute values: the rest of the Html is kept byte for byte (it is
not re-serialized), so the sealed Html is what the app wrote. The rewritten file replaces the local
Html, so a placeholder is gone after the first publish; an app that wants to keep it should rebuild
the Html before each publish.

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

Property `dataType` values are matched case-insensitively (`html` and `Html` both use the `bytes32` schema). Automation session keys cannot register or name schemas. If a schema is missing, unattended publish fails before the UserOp with `EasSchemasNotRegisteredError`. Register a model's schemas ahead of time, with no item, by calling `ensureEasSchemasForModels` with the owner ManagedAccount wallet. See [PUBLISH_AUTOMATION.md](./PUBLISH_AUTOMATION.md).

## Tool PublishedBy sidecar

Publishing tools (e.g. Permapress) can seal a **PublishedBy** attestation from a **tool-controlled wallet** after the author’s Seed/Version/property batch lands. This is a sidecar claim — not part of the author’s `multiPublish` / direct EAS batch — so ownership and revoke for the Seed stay with the author.

### Schema

Named `seedprotocol.publishedBy` (revocable):

```text
bytes32 seedUid, bytes32 versionUid, bytes32[] attestationUids, bytes32 batchHash, string toolName, string toolVersion
```

`refUID` is the Seed UID. Callers choose a payload mode at attest time:

| Mode | On-chain `attestationUids` | `batchHash` |
|------|----------------------------|-------------|
| **`uids`** | Full list from the publish batch | Always set to `hashPublishedByBatch(sortedUids)` (override allowed) |
| **`hash`** | Empty array | Required; keep the full UID list off-chain and verify with `verifyPublishedByBatch` |

### APIs (`@seedprotocol/publish`)

- `ensurePublishedBySchema(wallet)` — register + name once
- `attestPublishedBy({ wallet, seedUid, versionUid, toolName, toolVersion, mode: 'uids' \| 'hash', ... })`
- `revokePublishedBy({ wallet, uid })` — tool attester only
- `hashPublishedByBatch` / `collectPublishedBatch` / `getPublishedBySchemaUid`

### `onPublished` hook

Pass `onPublished` on `initPublish` config or `CreatePublishOptions`. When the publish machine reaches success, it invokes the callback with `{ seedLocalId, seedUid, versionUid, attestationUids }`. Tool backends should call `attestPublishedBy` from operator-controlled infra (do not embed the tool private key in the browser).

```ts
import {
  initPublish,
  attestPublishedBy,
  hashPublishedByBatch,
} from '@seedprotocol/publish'

initPublish({
  uploadApiBaseUrl: '...',
  onPublished: async ({ seedUid, versionUid, attestationUids }) => {
    // Run on a server with the tool wallet:
    await attestPublishedBy({
      wallet: toolWallet,
      seedUid,
      versionUid,
      toolName: 'Permapress',
      toolVersion: '1.0.0',
      mode: 'uids',
      attestationUids,
    })
    // Or hash-only:
    // mode: 'hash', batchHash: hashPublishedByBatch(attestationUids)
  },
})
```

### Reads (`@seedprotocol/eas` / `@seedprotocol/sdk`)

- `getPublishedByFromEas({ toolAddresses, refUIDs?, schemaUid?, excludeRevoked })`
- `decodePublishedByData(decodedDataJson)` / `verifyPublishedByBatch({ attestationUids, batchHash })`

Allowlist clients: filter non-revoked PublishedBy rows by the known tool attester, then treat only the listed UIDs (or a matching `batchHash`) as tool-endorsed — later author patches outside that batch are not covered.

## Inclusion and Staff halves

An Inclusion puts a post in a publication; Staff names an identity in a publication. Both need the two sides to agree, so each side attests its own half under the same schema, and either side ends the pair by revoking its half. Which half a record is follows from its attester.

| Schema | Definition | Half | Attested by | `refUID` |
|--------|------------|------|-------------|----------|
| `seedprotocol.inclusion` | `bytes32 publication,bytes32 post,bytes32 version` | author | the post seed's attester; `version` is zero | the owner half it answers, or zero (an offer) |
| | | owner | the publication seed's attester; `version` is the Version of the post it pins | the author half it answers or updates, or zero (an ask) |
| `seedprotocol.staff` | `bytes32 publication,bytes32 identity` | owner | the publication seed's attester | zero (an ask) |
| | | person | the identity seed's attester | the owner half it answers |

Both are revocable with the zero resolver; `INCLUSION_SCHEMA_UID` and `STAFF_SCHEMA_UID` in `@seedprotocol/eas` are the same on every chain. Every half's `recipient` is the attester of the other side's seed, so a party's waiting halves can be found by recipient.

### APIs (`@seedprotocol/publish`)

- `ensureInclusionSchema(wallet)` / `ensureStaffSchema(wallet)`: register and name the schema once per chain, from any wallet that isn't a session key.
- `attestInclusionHalf({ wallet, half: 'author', publicationUid, postUid, refUid? })`
- `attestInclusionHalf({ wallet, half: 'owner', publicationUid, postUid, versionUid, refUid? })`
- `attestStaffHalf({ wallet, half: 'owner', publicationUid, identityUid })`
- `attestStaffHalf({ wallet, half: 'person', publicationUid, identityUid, refUid })`
- `revokeInclusionHalf({ wallet, uid })` / `revokeStaffHalf({ wallet, uid })`: only the half's attester can revoke it.

The attest helpers read the seeds, the Version and the referenced half from the chain, and refuse before sending when:

- the wallet doesn't send as the half's attester (an automation session key never does: send a ManagedAccount's half from the account itself);
- both seeds have the same attester;
- `versionUid` isn't a live Version of the post by the post seed's attester;
- `refUid` isn't a live half of the same schema by the other side's attester, naming the same seeds.

A missing schema throws `PairSchemaNotRegisteredError`. Each helper resolves to `{ uid, schemaUid, recipient, refUid }`.

To read which pairs are live, use `getInclusions`, `inclusionsForPosts`, `getStaff` and `mastheadsForIdentity` from `@seedprotocol/query`, which apply the pair rules; `pendingFor` lists the offers and asks still waiting on an answer ([its README](../packages/query/README.md#publications-getinclusions-getstaff-pendingfor)).

## Revoking (Unpublishing)

To revoke attestations and remove an item from feeds and discovery, call `item.unpublish()`. Revocation is permanent; see [ATTESTATION_REVOCATION.md](./ATTESTATION_REVOCATION.md) for permanence, UX guidance, and republishing.
