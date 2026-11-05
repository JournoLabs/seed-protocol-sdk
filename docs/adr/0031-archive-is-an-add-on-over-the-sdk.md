# 0031. Archive is an add-on over the SDK

- **Status:** Accepted
- **Date:** 2026-11-03
- **Scope:** `@seedprotocol/archive`, `@seedprotocol/sdk`, `@seedprotocol/query`, `@seedprotocol/publish`

## Context

`exportArchive` and `verifyArchiveAgainstChain` were in the SDK from a8f5563e (2026-10-22), next to
the rows, publish graph, property definitions and file reads `exportArchive` uses.
`@seedprotocol/archive` held only the bag format (BagIt, PREMIS, Dublin Core, h-entry, path
manifests) and the verify entry. So every SDK install pulled in archive, though nothing builds a
bag unless an app asks for one, and an add-on built on archive (RDF graphs for bags, say) would
have pushed its own dependencies into the SDK.

Apps archive the seeds they create with the SDK, so archive's export has no use without it. One
reader does: `@seedprotocol/archive/verify` checks a published bag in a browser that has no SDK.

## Decision

Archive depends on the SDK, and the SDK doesn't depend on archive, as with publish, react and
mapping.

- `exportArchive`, `verifyArchiveAgainstChain`, `ArchiveExportError` and their types are exported
  from `@seedprotocol/archive/seed` (`packages/archive/src/seed/`). The SDK exports the reads they
  use from its main entry.
- `@seedprotocol/sdk` is an optional peer of archive. Only `/seed` imports it; the main entry,
  `@seedprotocol/archive/verify` and `@seedprotocol/archive/node` don't.
  `scripts/check-archive-no-sdk.js` fails when one of those three reaches the SDK.
- `readSeedAtTime`, what EAS held for a seed at a time, is in `@seedprotocol/query`. It reads only
  EAS, and other add-ons need the same reads.
- Archive installs no SDK runtime dependencies (`check-tier1-package-boundary.js` still covers
  it): its one database read goes through the SDK's `getVersionHistoryRows`.

## Consequences

An app that never archives doesn't install archive. Archive builds and publishes after the SDK
(`BUILD_ORDER`, `PUBLISH_ORDER`).

Breaking: these names move from `@seedprotocol/sdk` and `@seedprotocol/sdk/node` to
`@seedprotocol/archive/seed`, and an app that archives installs it. A tool that only builds or
checks bags uses the main entry, `/verify` or `/node`, without the SDK.

The SDK's main entry exports 25 more reads. Every package releases at the same version, so the
wider surface costs no compatibility.

The export tests run in the root `NodeJS` vitest project, which has the SDK's test setup; archive's
own tests run in the package.

## Alternatives considered

An `@seedprotocol/sdk/archive` subpath with archive as an optional peer of the SDK: keeps the export
beside the rows it reads, but leaves archive knowledge in the SDK, and each add-on built on archive
would need another SDK subpath.

Exporting the reads from an `@seedprotocol/sdk/internal` subpath: publish already reads through
the main entry, and two ways in would split the surface for no gain.

## Amendment (2026-11-05)

0.8.1 exported `exportArchive` and `verifyArchiveAgainstChain` from the main entry, so the main
entry imported the SDK and `createBag`, `validateBag`, `verifyArchive` and the other bag functions
failed to load without it (batch 16 item 50). They move to `@seedprotocol/archive/seed`, and the
main entry is SDK-free again, as it was in 0.8.0.

The move also changes what a bag names as its maker, since the SDK no longer makes it:
`Bag-Software-Agent` is `@seedprotocol/archive exportArchive (...)` and the PREMIS software agent is
`@seedprotocol/archive`. `EAS-Attester` and the PREMIS attester agent are EIP-55 checksummed in
every bag; an ordinary bag wrote the address in the case its row held. Both change a reproducible
bag's bytes, so `Seed-Bag-Format` is `2` ([ADR 0028](0028-reproducible-bag-format.md)). Format 1 is
not written any more. Its one anchored bag is on OP Sepolia, where trial anchors don't gate a
release; `verifyArchiveAgainstChain` reports a format 1 bag as `not_checked`, and
`verifyPublishedArchive`, which compares a bag with its anchor and doesn't rebuild it, still checks
it.
