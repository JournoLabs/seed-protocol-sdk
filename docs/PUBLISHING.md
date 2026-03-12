# Publishing

This guide covers the publish flow and schema setup requirements for apps that publish items to EAS.

## Publish flow (recommended)

When using the publish package (`@seedprotocol/publish`) with `ConnectButton` and its publish flow:

1. **ensureEasSchemasForItem** runs before `getPublishPayload`. It:
   - Registers EAS schemas for each item property via the SchemaRegistry contract
   - Adds naming attestations so EASSCAN displays schemas with friendly names
   - Populates the SDK's schema map so `getPublishPayload` can resolve schema UIDs

2. **getPublishPayload** builds the attestation payload for the item and any related seeds.

3. The payload is sent to the publish contract.

You do not need to run schema setup yourself when using this flow.

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
