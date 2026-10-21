# 0023. An owner can seal a Version; revoking a sealed value still removes it

- **Status:** Proposed
- **Date:** 2026-10-21
- **Scope:** `@seedprotocol/publish` (sealing, publish mode), `@seedprotocol/sdk` (publish
  payload, EAS sync, local reads), `@seedprotocol/query` (seed assembly, pinned reads, changelog),
  `@seedprotocol/eas` (schemas, fetches)

## Context

A Version is the owner's statement that a set of values belong together. Today that statement can
be amended: a `patch` publish attests more properties onto the current Version, and the newest
attestation per property wins (ADR 0011). A Version uid alone doesn't name fixed content, so a read
that must not change pins a time (`asOf`) as well.

Some owners need a Version to stay as published, so that any change to a value means a new
Version. Others keep amending Versions. Both are valid uses of the same statement.

EAS can't stop an attester from attesting again with a Version's uid as `refUID`, so immutability
has to come from an immutable record that readers honor. Making property attestations
`revocable: false` would make them permanent, but then a value could never be retracted (ADR 0021).

Property attestations can be revoked whether or not a Version is sealed. When the owner revokes a
value they once sealed, the later decision should win: telling the owner "you can't take that
back, you sealed it" serves no one who owns the data.

## Decision

### Sealing

A **seal** is an attestation that names a Version and lists exactly the property attestations it
holds:

- Schema `bytes32[] version_seal`. `refUID` is the Version uid. The data is the list of property
  attestation uids. Seals are `revocable: true`.
- It counts when its attester attested the Version. A listed uid counts when it is a property
  attestation of the seed's model, by the same attester, referencing one of the seed's Versions
  (or the Seed, for readers that accept that, ADR 0022). Anything else in the list is ignored.
- A listed attestation may reference an earlier Version. A new Version can then carry unchanged
  values over without attesting them again.
- If a Version has several seals, the newest live one counts. Revoking it unseals the Version,
  unless an older seal is still live, which then counts.

Publish takes `seal: true` to seal the Version it attests, after its property attestations. In
`patch` mode it seals the current Version with every property attestation the Version holds then.
A seal is a separate attestation from the attester, so an EOA publisher signs once more. Sealing
applies to one Version; the next Version isn't sealed unless that publish seals it too.

### Reading a sealed Version

A sealed Version holds the attestations its seal lists, and nothing else:

- Attestations made onto the Version after its seal, including removals (ADR 0021) and
  Seed-referencing patches (ADR 0022), don't count.
- A listed attestation that is revoked is dropped. The property reads as absent on that Version.
  This is the default, because the revocation is the owner's later decision.
- Readers that must show what was sealed regardless (an archive, an audit) pass
  `revokedSealedValues: 'keep'`: a revoked listed attestation still counts. EAS keeps a revoked
  attestation's data, so the value can still be read. The default is `'drop'`.
- A read pinned with `asOf` before the seal reads the Version as it was then, unsealed.

### Changing a sealed Version

Every later decision has a path:

- **Change a value:** a `patch` publish onto a sealed current Version publishes as `new_version`
  instead. `summarizePublishWork` reports the new Version.
- **Remove a value:** the same. The removal is attested onto the new Version.
- **Withdraw a value from everywhere, the sealed Version included:** retract it
  (`clear({ retract: true })`). The revocation drops it from the seal by default.
- **Undo the seal:** revoke the seal attestation.

## Consequences

- Owners who need fixed Versions get them without a new write model, and owners who don't are
  unaffected. Existing seeds have no seals and read as before.
- "Sealed" means fixed against additions and edits, not against withdrawal. An owner can always
  remove what they published. A reader that needs a stronger guarantee opts in with `'keep'`.
- A seal costs one attestation, and a signature for an EOA publisher.
- Readers fetch seals along with Versions: one more schema in the same kind of request. Sync needs
  somewhere to store seals and their member uids (a migration), and local reads must apply the
  seal to the Version it names.
- A seal that lists attestations from earlier Versions makes `new_version` cheaper: unchanged
  values needn't be attested again. Publish doesn't do that yet.
- Nothing is built yet. Implementation waits for a consumer that needs it.

## Alternatives considered

- **Keep revoked sealed values by default.** Rejected: it overrides the owner's later decision.
  Readers that need it can still opt in.
- **Make property attestations of a sealed Version `revocable: false`.** Rejected: nothing could
  ever be retracted, and the choice would have to be made before attesting, not when sealing.
- **Let later patches change a sealed Version.** Rejected: that is an unsealed Version. A change
  goes to a new Version instead, so the sealed one stays a fixed record.
- **Make every Version a list of attestation uids, with properties referencing the Seed.**
  Rejected for now (ADR 0022): it changes the write path and every reader. Sealing gives the same
  immutability to the owners who want it.
