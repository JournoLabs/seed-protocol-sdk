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
- `initPublish()` from `@seedprotocol/publish` must have been called (revocation uses the same wallet config)

**Throws:**

- `"Item is not published. Cannot unpublish."` if `!item.seedUid`
- `"Item has no schema UID. Cannot unpublish."` if `!item.schemaUid`
- `"Revocation is not configured. Call initPublish() from @seedprotocol/publish before using unpublish()."` if the revoke executor is not set
- `"No wallet connected. Connect a wallet to revoke attestations."` if no wallet is connected

## Local State

After revocation, the item's local state is updated:

- **`item.revokedAt`** – Unix timestamp when the attestations were revoked, or `undefined` if not revoked
- **`item.isRevoked`** – `true` if the item has been revoked

The `seedUid` is preserved. Revoked attestations remain on-chain but are marked as revoked; they no longer appear in discovery queries that filter by `revoked: false`.

## Republishing

To make content visible again, call `item.publish()`. This creates **new** attestations (a new `seedUid`). There is no "unrevoke" – republishing is a fresh publish.

## Suggested UX

1. **Before revoking:** Show a confirmation dialog:
   - "This will permanently revoke your attestations. The item will no longer appear in feeds. You can republish later to create new attestations."

2. **After revocation:** Show "Revoked" or "Unpublished" state in the UI.

3. **Disable or hide:** Disable or hide the "Unpublish" action for items that are not published (`!item.seedUid`).

4. **Filtering:** All discovery and feed queries exclude revoked attestations by default (`revoked: false`). No extra client-side filtering is needed.

## Related

- [Publishing.md](./PUBLISHING.md) – Publish flow and schema setup
- [getSeedsBySchemaName](../packages/sdk/src/eas.ts), [getSeedsFromSchemaUids](../packages/sdk/src/eas.ts) – EAS queries that exclude revoked by default
