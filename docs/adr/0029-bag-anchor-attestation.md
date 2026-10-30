# 0029. A bag is anchored by its own attestation on the Version

- **Status:** Proposed
- **Date:** 2026-10-30
- **Scope:** `@seedprotocol/eas`, `@seedprotocol/publish`, `packages/sdk/src/archive`

## Context

A reproducible bag's hash has to be on chain for a reader to trust it without rebuilding the bag
([ADR 0028](0028-reproducible-bag-format.md)). The bag is built from the Version's attestations, so
the hash can't be one of them, and it comes after them. Publishing must not depend on it.

## Decision

An anchor is an attestation under `ARCHIVE_ANCHOR_SCHEMA_DEF`:

```
uint64 covered_until,bytes32 manifest_tx,bytes32 tagmanifest_sha256
```

`refUID` is the Version, `covered_until` is the bag's `asOf`, `manifest_tx` is the path manifest's
Arweave transaction and `tagmanifest_sha256` is the SHA-256 of `tagmanifest-sha256.txt`. The schema
is revocable with the zero resolver, so its UID, `ARCHIVE_ANCHOR_SCHEMA_UID`, is the same on every
chain. It is registered once per chain, because a session key can't register a schema.

A reader counts an anchor only from the Version's attester: anyone can attest with any `refUID`.

An anchor is not a property. `getItemPropertiesFromEas` is the one read of attestations on a
Version, for sync, Query's remote source and bags, and it leaves anchors out.
`getAttestationChangesSince` leaves them out too, so an anchor doesn't count as a change to a seed.

## Consequences

An anchor changes no bag, no synced row and no Query record, and a bag's default `asOf` ignores it.
A new sidecar on a Version needs the same treatment, since the read excludes by schema.

The definition can't change without a new UID, so a change means a new schema and readers that
accept both.

## Alternatives considered

A field in the Version or an extra property: PermaPress keeps the Version record as it is, and a
property would change the state the bag describes.

Reading only known property schemas instead of excluding anchors: a property's schema comes from
the model, and the read has no model, as in sync's discovery of related seeds.
