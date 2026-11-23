# 0037. Attestation pair rules live in Query

- **Status:** Accepted
- **Date:** 2026-11-23
- **Scope:** `@seedprotocol/query`, `@seedprotocol/eas`

## Context

An Inclusion (a post in a publication) and Staff (an identity named in a publication) are
attestation pairs: each side attests its own half under the same schema, and the pair counts only
while both agree. Whether a pair is live depends on rules about attesters, revocation, which half
answers which and, for an Inclusion, which Version of the post is pinned. A client that applies
them differently lists a different set of posts or staff for the same title.

PermaPress, the only consumer, could apply the rules itself. The rules need only what Query
already reads (seed attesters, Versions, revocation), nothing from PermaPress's own model. Claims,
the next pair-like record PermaPress needs, raise the same question.

A new offer names the publication only in its data and has `refUID` zero, so the change check
Query's cache used (by `refUID` and `id`) could not see one.

## Decision

Query applies the pair rules. `getInclusions`, `inclusionsForPosts`, `getStaff` and
`mastheadsForIdentity` share one evaluator that takes the newest half per side (latest
`timeCreated`, then the greater uid) whether revoked or not, ignores halves by anyone but the two
seeds' attesters, skips pairs whose seeds share an attester, and then checks:

- for an Inclusion, that neither half is revoked, they are linked, no owner half linked to the
  author half is revoked, and the owner half pins a live Version of the post by its attester made
  by the owner half's `timeCreated`;
- for Staff, that neither half is revoked and the person half's `refUID` is the owner half.

Every half's `recipient` is the other side's seed attester. Reads find halves by schema and by
attester or recipient; `recipient` is only an index and attesters are always checked.

The cache's change check also asks for attestations of the pair schemas by, or addressed to, the
seed's attester, so a cached answer sees a new or revoked half on either side.

Claims will follow the same way: their rules go in Query, not in each client.

## Consequences

- Every Seed client that reads through Query lists the same posts and staff.
- Changing a rule is a Query release and a breaking change for anyone relying on the old answer.
- A half whose `recipient` isn't the other side's attester is not found. The publish helpers
  always set it; a hand-made half that doesn't is invisible to these reads.
- A publication's own posts and identities (same attester) are not listed. Apps add them from
  their own relations.
- Revoking a superseded owner half that the author half answered ends the Inclusion, so apps
  should not offer to tidy up old owner halves.

## Alternatives considered

- **Each app applies the rules.** Clients drift, and the same title shows different staff
  depending on the reader.
- **Find halves by decoded data.** The EAS indexer can't filter on decoded fields, so a
  publication's offers would mean scanning every Inclusion.
- **A resolver contract that enforces the rules on chain.** Seed schemas use the zero resolver
  (ADR 0035), and the rules are about the newest state across several attestations, which a
  per-attestation resolver can't decide.
