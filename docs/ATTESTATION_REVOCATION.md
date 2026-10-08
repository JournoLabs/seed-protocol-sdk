# Attestation Revocation (Unpublishing)

This guide covers revoking Seed attestations and related Version/metadata attestations on EAS, and the UX implications.

## Permanence

**Revocation is permanent.** EAS does not support unrevoking. Once revoked, attestations stay revoked on-chain. The content will no longer appear in EAS queries, feeds, or indexing.

## Use Case

Use revocation when a user no longer wants their Seed to appear in:

- EAS discovery queries
- Feeds and indexes
- Any public-facing views that filter by `revoked: false`

## API

### `item.unpublish()`

Revokes the Seed attestation and all Version and metadata attestations for the item.

```typescript
await item.unpublish()
```

**Requirements:**

- The item must be published (`item.seedUid` must be set)
- The caller must own the item (ownership is asserted before revocation)
- `initPublish()` from `@seedprotocol/publish` must have been called, or `PublishProvider` must be mounted with config (revocation uses the same wallet config)

**Throws:**

- `"Item is not published. Cannot unpublish."` if `!item.seedUid`
- `"Item has no schema UID. Cannot unpublish."` if `!item.schemaUid`
- `"Revocation is not configured. Call initPublish() from @seedprotocol/publish or ensure PublishProvider is mounted with config."` if the revoke executor is not set
- `"No wallet connected. Connect a wallet to revoke attestations."` if no wallet is connected
- `"Only the original attester can revoke attestations. Connect the wallet that published this item."` if the connected wallet is not the attester who created the attestation (EAS `AccessDenied`)
- `"Revocation not supported for items attested by the Seed executor module: …"` if the on-chain attester is the executor module. The executor has no revoke, so nobody can revoke these (prefer the ManagedAccount as attester; see [PUBLISH_AUTOMATION.md](./PUBLISH_AUTOMATION.md))
- `"Automation session keys cannot revoke attestations. …"` if the connected publish wallet is an automation session key. Revoking is owner-only

## Wallet and Attester

When attestations were created by the ManagedAccount (in-app wallet, EIP4337), the SDK will attempt to use that wallet for revoke if the user is connected with a different wallet (e.g. EOA or modular account) that controls the same ManagedAccount. If the ManagedAccount wallet can be auto-connected, the revoke will succeed without the user switching wallets.

With **`useModularExecutor`**, publish sends `multiPublish` to the user’s **ManagedAccount** contract (the modular account signs the transaction). EAS records whatever address actually invoked `attest` / `multiAttest` on-chain (typically the ManagedAccount or its delegate path), not the standalone SeedProtocol deployment used only as the **ABI** for encoding `multiPublish`. Unpublish uses the same attester resolution as other ManagedAccount flows when the on-chain attester matches the managed account. Prefer keeping the **ManagedAccount** as the EAS attester. Revocation is owner-only: `multiRevoke` always goes to EAS from the publishing account, never through the executor module (which has no revoke), so automation session keys cannot revoke. Items whose EAS attester is the **executor module** cannot be revoked — see [PUBLISH_AUTOMATION.md](./PUBLISH_AUTOMATION.md).

## Local State

After revocation, the item's local state is updated:

- **`item.revokedAt`** – Unix timestamp when the attestations were revoked, or `undefined` if not revoked
- **`item.isRevoked`** – `true` if the item has been revoked

The `seedUid` is preserved. Revoked attestations remain on-chain but are marked as revoked; they no longer appear in discovery queries that filter by `revoked: false`.

The item's version rows (`versions`) and property rows (`metadata`) keep their values and get `revoked_at` (Unix seconds) for the attestations that were revoked.

### EAS sync

Sync fetches revoked attestations too and keeps local metadata on the canonical attestation per (version, property schema): the newest non-revoked one. When that attestation is later revoked, sync replaces the stored row with the next newest live attestation; when a newer one is published, it replaces the stored row. When every attestation of a property on a version is revoked (an unpublished item), sync keeps the newest one with `metadata.revoked_at` set, so a revoked item synced to a new device still has its last values. A non-null `revoked_at` therefore means "kept for its last value", not "present on the version". Readers pick each property's value across versions by preferring the newest row with `revoked_at` null (local drafts included), and fall back to the newest revoked row only when no live row is left, so a property revoked on a newer version doesn't hide a live value on an older one. Rows sync derives for ItemStorage properties from a `storage_transaction_id` attestation follow that attestation: they're removed when it stops being canonical and carry its `revoked_at`. Seeds, versions and metadata record `revoked_at` from EAS `revocationTime`, for already-stored rows too. A stamp written by local unpublish (on the seed, its versions and its property rows) is kept until EAS reports a revocation time, which then replaces it: unpublish stamps only after its revoke transactions are mined and revocation is permanent, so EAS still reporting an attestation live means its index lags. Derived ItemStorage rows take their source row's stamp the same way and never lose one to a live report.

## Republishing

To make content visible again, call `item.publish()`. This creates **new** attestations (a new `seedUid`). There is no "unrevoke" – republishing is a fresh publish.

## Suggested UX

1. **Before revoking:** Show a confirmation dialog:
   - "This will permanently revoke your attestations. The item will no longer appear in feeds. You can republish later to create new attestations."

2. **After revocation:** Show "Revoked" or "Unpublished" state in the UI.

3. **Disable or hide:** Disable or hide the "Unpublish" action for items that are not published (`!item.seedUid`).

4. **Filtering:** All discovery and feed queries exclude revoked attestations by default (`revoked: false`). No extra client-side filtering is needed.

## Tool PublishedBy revoke

`item.unpublish()` revokes the **author’s** Seed / Version / property attestations only. It does **not** revoke a tool’s PublishedBy sidecar (different attester).

When a publishing tool mediates unpublish, call `revokePublishedBy({ wallet: toolWallet, uid })` from `@seedprotocol/publish` so allowlisted clients lose the live tool pointer. Revoked PublishedBy rows remain on-chain and can still be queried with `excludeRevoked: false` for historical reconstruction.

## Tool DomainOwnership revoke

`item.unpublish()` does **not** revoke a tool’s DomainOwnership attestation (different attester and schema). Call `revokeDomainOwnership({ wallet: toolWallet, uid })` from `@seedprotocol/publish` when a live RDAP recheck returns `likely_transferred` or when the tool withdraws the claim. See [DOMAIN_OWNERSHIP.md](./DOMAIN_OWNERSHIP.md).

## Related

- [Publishing.md](./PUBLISHING.md) – Publish flow, schema setup, and PublishedBy sidecar
- [DOMAIN_OWNERSHIP.md](./DOMAIN_OWNERSHIP.md) – Tool domain ownership sidecar (DNS TXT + RDAP + EAS)
- [getSeedsBySchemaName](../packages/sdk/src/eas.ts), [getSeedsFromSchemaUids](../packages/sdk/src/eas.ts), [getPublishedByFromEas](../packages/sdk/src/eas.ts) – EAS queries that exclude revoked by default
