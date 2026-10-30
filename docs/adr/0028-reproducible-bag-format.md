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

- The time it covers, `asOf`, in unix seconds. bag-info.txt records it as `Seed-Bag-As-Of`. The
  default is the last attestation or revocation on the properties of the newest live Version.
- The seed's attestation, and its Versions up to and including the newest one live at `asOf`, as EAS
  reports them.
- For each property schema on that Version, from the Version's attester, the attestation current at
  `asOf`. The rule is sync's, with "revoked" meaning revoked by `asOf`: the newest live attestation,
  else the newest one, which is a retraction and holds no value.
- The same selection on each storage seed, and the bytes of the Arweave transactions those
  attestations name.
- The schema, which decides the model and property names in the bag.
- The chain id and the rules of the format version, including the text of `VERIFY.txt`.

So the export reads no rows and no local files: a device with the schema loaded and nothing else
gets the same bag, named by `{ seedUid, modelName, schemaName }`, and an unpublished edit changes
nothing. The following never reach the bytes: the export time, device clocks, local file names,
local seed ids, the configured gateway, `sourceOrganization`, and anything that happens after
`asOf`. Relations are recorded as seed uids. Files are typed by their bytes. Html in `data/source/`
is the transaction's bytes unchanged. An export that can't meet this refuses (`not_synced`,
`chain_unavailable`, `incomplete`, `invalid_options`).

bag-info.txt's `Seed-Bag-Format` holds the format version, now `1`. A change that would alter the
bytes for the same inputs raises it, and the SDK keeps writing and checking every version that has
anchored hashes.

## Consequences

A bag exported with an `asOf` never changes: a later patch, Version, retraction or revocation is
after the time it covers. A reader checks revocation on EAS. An export without one follows the
seed, so it changes when any of those happen, including the revocation of an attestation that had
already been superseded, which moves the default time and leaves the values alone. Anchors record
`asOf`, and `verifyArchiveAgainstChain` rebuilds at the bag's `Seed-Bag-As-Of`, so an old bag stays
checkable after the seed moves on.

Every export downloads its files, since a local copy isn't proof of the transaction's bytes: a
publisher's Html file can differ from what it uploaded. So a reproducible export needs a gateway
that serves them, and refuses `fetch: false`.

Keeping old format versions writable is a real cost once hashes are anchored, and until then the
format can change freely at version `1`.

`exportArchive.chain.test.ts` proves this with no rows for the seed, against a fake EAS and gateway,
for each property type, Html, images, composites, patches, retractions and revocations.

## Alternatives considered

Record revocations in the bag: they are useful to a reader, but they come after the attestation,
so the anchored hash could never match a later export.

Put the SDK version in the bag: every release would change every hash, including releases that
don't touch the format.
