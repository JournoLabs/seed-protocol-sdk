# 0011. Reading a seed at a version takes a time as well as a version uid

- **Status:** Accepted
- **Date:** 2026-10-17
- **Scope:** `@seedprotocol/query` (`getSeed`, `getSeeds`, seed assembly, item cache keys)

## Context

PermaPress pins a post at a version: a portfolio clip, or an Inclusion in a title, names the
post and the version uid its owner read, and the page must show that version, not the latest.
Query could only assemble a seed's latest version, so PermaPress folded the changelog's flat
`after` maps up to the pinned uid.

A version uid doesn't name fixed content. The SDK publishes in two modes
(`getPublishPayload`, `summarizePublishWork`):

- `new_version` attests a new Version with every non-empty property.
- `patch`, the default, attests only the changed properties, referencing the seed's current
  published Version. It never creates a Version.

Assembly takes the newest property attestation per version and property schema
(`pickLatestPropertyAttestationsByRefAndSchema`). So after a patch, the pinned version uid
assembles to the patched text, while that version is still the head the author patches.
PermaPress offers both modes ("Publish updates" is `patch`).

## Decision

`getSeed(seedUid, { versionUid, asOf })` and `getSeeds(seedUids, { pins })` assemble a seed at
a `VersionPin`:

- `versionUid` names one of the seed's versions. It must be a live version attested by the
  seed's attester. The uid matches in any case.
- `asOf` (unix seconds) leaves out attestations created after it: the version, if it was
  created later, and property attestations made later. With `asOf` alone, the seed's newest
  version created by then is read.
- A seed without the pinned version is left out: `getSeed` returns null, and `getSeeds` has no
  entry for it.
- Assembly is otherwise what `getSeed` does for the latest version: the same attester
  filtering, relations expanded, storage hydrated. Related seeds are assembled at their latest
  version, because relations name seeds, not versions.
- The item cache key includes the pin (`-v<uid>`, `-a<asOf>`), so pinned and latest reads are
  cached apart.

Pinned text that can't change needs `asOf`: the time the pin was made (for example the pinning
attestation's `timeCreated`).

## Consequences

- A caller that pins by version uid alone sees later patches to that version. This is the
  behavior PermaPress's changelog fold already had.
- A property attestation revoked after `asOf` is missing from an `asOf` read, because the
  indexer query leaves revoked attestations out; the read falls back to the property's earlier
  attestation on that version, or to none.
- `getSeeds` can read a seed at one version per call; two pins of the same seed take two calls.

## Alternatives considered

- **`versionUid` alone.** Rejected: it doesn't give PermaPress what decision 0134 promises an
  owner (the text they read) whenever the author patches.
- **Make `patch` create a Version.** Rejected for this change: it alters publishing and every
  existing seed's history, and a version uid would still not freeze relations.
- **Snapshot related seeds as of `asOf` too.** Rejected for now: it would need each related
  seed's version history in the batch, and no caller has asked for it.
