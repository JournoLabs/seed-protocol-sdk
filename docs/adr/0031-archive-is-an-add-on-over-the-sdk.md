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
  from `@seedprotocol/archive` (`packages/archive/src/seed/`). The SDK exports the reads they use
  from its main entry.
- `@seedprotocol/sdk` is an optional peer of archive. Archive's main entry imports it;
  `@seedprotocol/archive/verify` and `@seedprotocol/archive/node` don't.
  `scripts/check-archive-verify-no-sdk.js` fails when `src/verify.ts` reaches the SDK.
- `readSeedAtTime`, what EAS held for a seed at a time, is in `@seedprotocol/query`. It reads only
  EAS, and other add-ons need the same reads.
- Archive installs no SDK runtime dependencies (`check-tier1-package-boundary.js` still covers
  it): its one database read goes through the SDK's `getVersionHistoryRows`.

## Consequences

An app that never archives doesn't install archive. Archive builds and publishes after the SDK
(`BUILD_ORDER`, `PUBLISH_ORDER`).

Breaking: these names move from `@seedprotocol/sdk` and `@seedprotocol/sdk/node` to
`@seedprotocol/archive`, and an app that archives installs it. Importing archive's main entry
without the SDK installed fails, so a tool that only builds or checks bags without the SDK uses
`@seedprotocol/archive/verify` or `/node`.

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
