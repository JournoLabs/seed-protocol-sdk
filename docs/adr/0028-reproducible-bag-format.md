# 0028. A reproducible bag's bytes are a versioned format

- **Status:** Proposed
- **Date:** 2026-10-30
- **Scope:** `packages/sdk/src/archive`, `@seedprotocol/archive`

## Context

`exportArchive(item, { reproducible: true })` builds a BagIt bag whose
`tagmanifest-sha256.txt` hash is the same on every client. That hash is meant to be anchored in the
Version's EAS record and signed. Once a hash is on chain, any change to the
bytes makes old bags impossible to reproduce and check, so the rules need to be fixed and changes
to them visible.

## Decision

A reproducible bag is a function of these inputs and no others:

- The seed's attestation, its Versions up to and including the exported one, and the live property
  attestations on that Version, all as EAS reports them.
- The bytes of the files those attestations name.
- The schema, which decides the model and property names in the bag.
- The chain id and the rules of the format version, including the text of `VERIFY.txt`.

So the following never reach the bytes: the export time, device clocks, local file names, local
seed ids, the configured gateway, `sourceOrganization`, and revocations of other Versions. Relations
are recorded as seed uids. Files are typed by their bytes. Lists are in a fixed order. An export
that can't meet this refuses (`not_synced`, `chain_unavailable`, `incomplete`, `invalid_options`).

bag-info.txt's `Seed-Bag-Format` holds the format version, now `1`. A change that would alter the
bytes for the same inputs raises it, and the SDK keeps writing and checking every version that has
anchored hashes.

## Consequences

Later revocations don't touch a bag, so a reader must check revocation on EAS. A patch or a
retraction on the current Version changes the live property attestations, so it changes the bag:
the hash identifies a Version's state at a point in its life, not the Version uid alone.

Keeping old format versions writable is a real cost once hashes are anchored, and until then the
format can change freely at version `1`.

`exportArchive.sync.test.ts` proves this for Text, Number, Boolean, Relation and List values, with
rows rebuilt by EAS sync. Html and files are covered by tests on one set of rows, and nothing yet
compares a publisher's stored Html with the bytes a syncing client downloads.

## Alternatives considered

Record revocations in the bag: they are useful to a reader, but they come after the attestation,
so the anchored hash could never match a later export.

Put the SDK version in the bag: every release would change every hash, including releases that
don't touch the format.
