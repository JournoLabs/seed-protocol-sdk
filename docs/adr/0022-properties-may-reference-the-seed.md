# 0022. Readers can accept property attestations that reference the Seed

- **Status:** Proposed
- **Date:** 2026-10-21
- **Scope:** `@seedprotocol/query` (seed assembly, changelog, pinned reads), `@seedprotocol/sdk`
  (EAS sync, local reads), `@seedprotocol/eas` (property fetches, canonical pick)

## Context

The SDK attests every property onto a Version: its `refUID` is the Version uid, in `patch` mode
the seed's current Version and in `new_version` mode a new one (ADR 0011). Readers find a seed's
properties only that way. Query and sync fetch property attestations with `refUID` in the seed's
Version uids, and keep those whose attester attested the Version (`partitionByRefAttester`). ADR
0006 defines a property as present when its `refUID` is a candidate version of the seed, and
`PUBLISHING.md` says a property's `refUID` is its Version. Nothing forbids a property attestation
that references the Seed; readers never look for one.

Other writers can make one: another SDK, a hand-made attestation, or a mistake. EAS accepts any
existing attestation as a `refUID`, so the attestation is valid on chain, and today Seed readers
drop it.

Some apps may want those values and others won't. No consumer has asked for either yet.

## Decision

Readers take a `propertyRefs` option:

- `'version'` (default): properties are read from the seed's Versions only, as today.
- `'versionOrSeed'`: property attestations whose `refUID` is the Seed uid are read too.

The option applies to `@seedprotocol/query` (`getSeed`, `getSeeds` and the other assembly
entry points, and the changelog) and to EAS sync, which decides what local reads see.

With `'versionOrSeed'`:

- **Fetching.** The seed uid joins the Version uids in the `refUID` filter of the property fetch,
  in the same request.
- **Who counts.** A Seed-referencing property counts only when its attester attested the Seed,
  the rule Version-referencing properties already follow for their Version. Only attestations of
  the model's own property schemas count, so sidecars that reference the Seed (PublishedBy)
  are never read as properties.
- **Precedence.** A Seed-referencing property attestation counts as a patch to the Version that
  was the seed's latest when it was made (by `timeCreated`): the newest attestation of that
  property on that Version wins, whichever it references. So a later Version's attestation
  supersedes it, a read pinned to that Version includes it (ADR 0011's `asOf` applies as to any
  patch), and one made before the seed's first Version counts toward the first Version.
- **Clearing.** A removal or retraction (ADR 0021) counts the same way: an empty value that
  references the Seed removes the property from that Version, and a retraction of the property on
  that Version revokes its Seed-referencing attestations too.
- **Locally.** Sync stores a Seed-referencing property with the local Version it counts toward,
  and with no `version_uid`. Local reads need no other change.

The SDK keeps publishing properties onto a Version. This decision is about what readers accept,
not a second way to write.

## Consequences

- An app can show values another writer attached to a seed without a Version, by opting in.
  Apps that don't opt in see no change.
- A read in `'versionOrSeed'` mode can show a value the publisher attached by mistake. That is the
  point of the option, so it stays opt-in.
- A changelog read in `'versionOrSeed'` mode lists Seed-referencing attestations as patches to the
  Version they count toward.
- Immutable ("sealed") Versions are a separate decision. A sealed read would use only the
  attestations the seal lists, so this precedence rule wouldn't apply to it.
- Nothing is built yet. Implementation waits for a consumer that needs it.

## Alternatives considered

- **Default `'versionOrSeed'`.** Rejected: every app would start showing such values as soon as
  one appeared, and nothing the SDK publishes needs it.
- **Seed-referencing values override every Version.** Rejected: a stray attestation would then
  outrank later Versions the owner published on purpose.
- **Properties reference the Seed, and a Version lists attestation uids.** Not taken here. It
  would make Versions immutable and cheaper to snapshot, but it changes the write path and every
  reader, and still needs a rule for patches. Sealing a living Version gets immutability without
  that migration.
