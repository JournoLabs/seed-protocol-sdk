# 0021. A property is cleared by attesting an empty value or by revoking its attestations

- **Status:** Accepted (being implemented)
- **Date:** 2026-10-21
- **Scope:** `@seedprotocol/sdk` (ItemProperty, outbox `set` applier, metadata table, publish
  payload, publish summaries, EAS sync, local reads), `@seedprotocol/publish` (revocation after
  attesting), `@seedprotocol/query` (seed assembly, changelog), `@seedprotocol/react` (SeedImage)

## Context

PermaPress wants a Remove control on image fields. The SDK had no way to clear a property:

- `setValue('')` on an Image saved an image seed for the `images` folder, and `setValue(null)`
  failed and left `null` on screen. Both are refused since `empty_storage_value` (step 1 of this
  work); clearing still isn't possible.
- Publish skips empty values (`getPublishPayload`, `summarizePublishWork`). In `patch` mode a
  property attested before keeps that attestation, so a reader still sees the old value. The same
  happens to a Text property edited to `''`.
- Readers disagree on what an earlier Version leaves behind. Query assembles a seed from its
  latest (or pinned) Version only. The SDK's local reads take the newest row per property name
  across every Version, and several of them prefer an older non-empty row over a newer empty one.

Owners want removal recorded in two ways. Some want a full edit history, where the removal shows
as a change and the old value can be restored. Others want a published value withdrawn, so it
stops showing in reads of the past as well. EAS supports both: property attestations are created
`revocable: true`, and a revocation leaves the attestation on chain with its revocation time.
Neither way deletes anything: the old attestation stays on chain, and an uploaded file stays on
Arweave.

## Decision

### API

`await property.clear()` removes the value. `await property.clear({ retract: true })` retracts
it. Both show the property as empty at once, write a cleared row through the outbox (ADR 0019),
and resolve when it is stored, like `save()`. A refused or failed clear restores the shown value.

`setValue(null)` and `setValue('')` on an Image, File or Html property (or a Relation to Image)
call `clear()`. On other types they keep their meaning: the value is stored as given.

### Removal attests an empty value

Each EAS type has an empty value:

| EAS type | Seed types | Empty value |
| --- | --- | --- |
| `string` | Text, Number | `''` |
| `bytes32` | Image, File, Html, Json, Relation | `0x` followed by 64 zeros |
| `bytes32[]` | List | `[]` |
| `bool`, `uint256` | Boolean, Date | none |

A property is published as removed when its current local value is empty (`null`, `''`, or an
empty List) and it has a live attestation on the seed: Publish attests the empty value, in both
`patch` and `new_version` mode. A property that was never attested publishes nothing. Boolean and
Date have no empty value: `clear()` without `retract` rejects with `ClearNotSupportedError`, and
Publish fails validation (`publish_clear_unsupported`) for a published Boolean or Date set to
`null`.

The removal is an ordinary attestation, so the property's history shows it, a read pinned to an
earlier Version or time still sees the old value, and assigning the old value again restores it.

### Retraction revokes

A retracted property publishes no attestation. Publish revokes every live attestation of the
property on the Version of its newest live one (the seed's current Version, unless the property
was attested only on an earlier one), and every live attestation of the property on its other
Versions whose value is one of those. Revocation goes to EAS `multiRevoke` from the attester, as a
transaction after the attestations; an EOA publisher signs it separately. Automation session keys
and executor-attested seeds can't revoke (`ATTESTATION_REVOCATION.md`), so Publish fails for a
retraction there before it attests anything.

The cleared row records `retract`. It stays pending until no attestation in that scope is live,
so a failed or interrupted revocation is sent again by the next Publish.

### Readers treat an empty or retracted value as absent

- Query leaves the property out of the assembled seed when its value is `''` or a zero `bytes32`,
  and never fetches a zero `bytes32` as a related seed. An empty List stays `[]`. The changelog
  reports the property as removed.
- EAS sync stores a `''` or zero `bytes32` attestation as a row with a `NULL` value, keeping its
  uid. A revoked property attestation on a live seed is stored with a `NULL` value. A revoked seed
  keeps its last values, as before (`ATTESTATION_REVOCATION.md`). `item.unpublish()` revokes the
  seed first, so a sync between its batches sees a revoked seed, not retracted properties.
- Local reads show a `NULL` newest row as no value and don't fall back to an older row.
- Local reads take each property's newest row whether or not it is revoked. Readers used to prefer
  any live row, so a property retracted on the current Version showed an earlier Version's
  value (`ATTESTATION_REVOCATION.md` described that preference). Sync keeps one attestation per
  Version and property schema (ADR 0006), so a revoked row is newest only when its Version has
  none live.

`0x0000…0020` stays excluded where it is today. It is most likely the ABI offset word of a dynamic
value decoded as `bytes32`; nothing in this repository writes it.

## Consequences

- PermaPress can offer Remove and Retract on image fields, and any property but Boolean and Date
  can be removed. A Boolean or Date can only be retracted.
- Clearing a Text field to `''` after it was published now attests `''`, where before the old text
  stayed on chain. Publishing such an item attests one property more than before.
- A retraction from an EOA costs a second signature. A Publish that attests and revokes can
  succeed at attesting and fail at revoking; the item is then partly published until the next
  Publish sends the revocation.
- Retraction is permanent: EAS can't undo a revocation. Setting the value again attests it anew.
- The cleared value's old image seed and file stay on this device, as they do when an image is
  replaced.
- A property removed or retracted on the current Version no longer reads an earlier Version's
  value locally. A property the current Version doesn't attest at all still does, where query
  reads it as absent: a `new_version` publish from an SDK before this one skipped empty
  properties. Reading strictly from the current Version would close that, and is left for later.
- Readers built on other SDKs see `''`, a zero uid, or a missing attestation, depending on the
  mode. Seed's convention is documented in `ATTESTATION_REVOCATION.md`.

## Alternatives considered

- **Revocation only.** Rejected as the only mode: it hides the value from reads of the past, which
  owners who keep an edit history don't want, and in `patch` mode a reader falls back to an
  earlier attestation on the same Version unless every one is revoked.
- **Omit the property in `new_version` mode instead of attesting the empty value.** Rejected: it
  relies on every reader treating a Version as a full snapshot, and the SDK's own readers didn't.
- **A separate marker value for Boolean and Date.** Rejected for now: no consumer needs to remove
  one, and retraction covers withdrawing it.
- **Retract on every Version.** Rejected: it would also hide different, earlier values that the
  owner didn't retract.
