# Changelog

All notable changes to this package are documented in this file.

## 0.7.4 (2026-10-15)

### Commits

#### Features

- easName and EAS name matching (ADR 0008) (2512d50b)

#### Fixes

- publish: domain ownership attests what was proven and honours expiry (8c5ef8e3)
- sdk, query: only a seed's attester can add its versions and properties (73e23776)
- query: throw when clients are registered on another copy of eas/arweave (aec6c2e7)

## 0.7.3 (2026-10-14)

### Commits

#### Fixes

- query: use already-registered EAS/Arweave clients instead of loading /node (005e192f)

## 0.7.2 (2026-10-11)

### Changed

- **`NodeQueryClient` is a real TanStack Query client** (`@tanstack/query-core`, now a dependency) instead of a passthrough: concurrent requests with the same key share one fetch (5 concurrent `getSeed` calls for one post: 30 EAS requests → 6). Nothing is kept once a request settles unless the caller passes `staleTime`; no retries; keys are scoped to the EAS endpoint. The SDK's Node platform uses it too. `networkMode: 'onlineOnly'` maps to TanStack v5's `'online'`.

### Commits

#### Features

- back NodeQueryClient with a TanStack Query client (5f97bc6d)

## 0.7.1 (2026-10-10)

### Changed

- **Faster Version and property reads:** the `attestationFields` fragment (used by `GET_VERSIONS`, `GET_PROPERTIES`, `GET_ALL_PROPERTIES_FOR_ALL_VERSIONS`, `GET_FILES_METADATA`, `GET_IMAGE_VERSIONS`) no longer selects `schema { schemaNames }`. easscan resolves that join slowly (properties for ~170 versions: ~1.8 s with it, ~0.26 s without). Version and property attestations from these queries no longer carry `schema`; read `schemaId` instead.
- **`getSeedsBySchemaName`** fetches seeds without the schema join and sets `schema.schemaNames` to the requested name. A new optional 4th argument `{ uidPrefix }` limits it to seeds whose UID starts with the prefix (easscan matches case-sensitively: pass lowercase with `0x`).

### Added

- **`GET_SEEDS_LEAN`**: `GET_SEEDS` without `schema { schemaNames }`.
- **`getSeedsByUidsFromEas({ uids, excludeRevoked })`**: seeds by UID, with `schema.schemaNames` attached from `schemaId`.
- **`getAttestationChangesSince({ refUIDs, ids, since })`** and **`GET_ATTESTATION_CHANGES`**: attestations created or revoked after `since` that reference one of `refUIDs` or are one of `ids` (one request per 400 UIDs). Used by `@seedprotocol/query` to check cached seeds for changes.
- **`getSchemaNamesBySchemaUids(schemaUids)`**: schema names by schema UID, cached per EAS endpoint for the process (`resetSchemaNamesCache` for tests).

### Commits

#### Features

- query: look up seeds of a schema by uid prefix (2d8d129d)

#### Fixes

- query: check cache hits for changes instead of rebuilding or going stale (5ec227f7)

#### Other

- query: drop the slow schema-name join from attestation reads (b0fcdb37)

## 0.7.0 (2026-10-08)

### Commits

#### Fixes

- select revocationTime on version and property attestations (8a7f891d)
- skip revoked attestations when picking canonical property (b8b95590)
- sdk: include query inputs in EAS fetchQuery keys (b6793cab)

#### Other

- sdk: cache EAS schema lookups, including misses (6daf71c0)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Features

- publish: verify the publish chain before writing; hold EAS sync until the chain is known (5f4fc0ee)
- sdk: record the EAS chain in the local DB and refuse cross-chain writes (7d8af9d5)
- sdk: read EAS from the configured chain and register base schemas on new chains (91e0290e)
- publish: make the publish chain and EAS addresses configurable (811b8fc5)

#### Fixes

- publish: rollout and twin follow-ups from protocol review (415c9c1b)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Features

- publish: add PublishedBy batch sidecar attest/revoke/query APIs (14233083)

#### Other

- Final edits (687d320b)
- Keep Node builtins and CJS keccak off the Seed browser graph. (3bc60ae1)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Added

- **Publish authorization helpers:** `PUBLISH_AUTHORIZATION_*`, `decodePublishAuthorizationData`, `assessPublishAuthorization`, and `getPublishAuthorizationFromEas` for the `seedprotocol.publishAuthorization` sidecar.
- **Domain ownership helpers:** `DOMAIN_OWNERSHIP_SCHEMA_*`, challenge/TXT builders, `hashDomainOwnershipChallenge`, `hashDomainRegistryFingerprint`, `decodeDomainOwnershipData`, `assessDomainOwnership`, and `getDomainOwnershipFromEas` for the `seedprotocol.domainOwnership` sidecar.

### Commits

#### Features

- add publishAuthorization sidecar helpers (11bb0ca7)

#### Other

- Add domain ownership DNS challenge, RDAP snapshot, and EAS sidecar tooling. (c51a1226)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- extract EAS GraphQL client and helpers into @seedprotocol/eas (8c9e21b4)

#### Other

- replace setPlatformClass with instance + static facade (0bca44b7)
- tier1: consolidate remaining GraphQL queries in eas and arweave (2c64d2f1)

## 0.5.0

Initial release: EAS GraphQL read client, schema UID cache, and Node platform registration.
