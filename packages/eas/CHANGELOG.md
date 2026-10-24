# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- **Breaking:** the deprecated `EasClient` and `QueryClient` aliases are removed from `@seedprotocol/eas/node`. Use `NodeEasClient` and `NodeQueryClient`.

## 0.7.10 (2026-10-24)

### Commits

#### Fixes

- build: pin @types/bun to 1.4.3 (0dd3ed34)

## 0.7.9 (2026-10-22)

- On Node, `NodeEasClient` (registered by `@seedprotocol/eas/node` and `registerNodeEasPlatform`) sends EAS requests through its own undici `Agent` that offers only the X25519 and P-256 key-exchange groups and keeps idle connections for 30 s. Node 24.21+ also offers the post-quantum X25519MLKEM768 group by default; easscan doesn't support it, and with it each new connection's TLS handshake took about 1.45 s instead of about 175 ms. Node's fetch drops idle connections after 4 s, so most reads after a pause paid it. The process's TLS defaults and fetch's global dispatcher are unchanged. Under Bun or Deno undici is not loaded, and when the host has set a proxy or mock as fetch's global dispatcher (`setGlobalDispatcher`, `NODE_USE_ENV_PROXY`) EAS requests keep using it. Pass `new NodeEasClient({ dispatcher: false })` or `registerNodeEasPlatform({ easClient: { dispatcher: false } })` to use fetch's defaults, a `Dispatcher` of your own, or `dispatcherOptions: { ecdhCurve, keepAliveTimeoutMs }`. `createEasNodeDispatcher` builds the default one. `@seedprotocol/eas` now depends on `undici`; only the `./node` entry loads it.
- `createEasGraphQLClient(url, timeoutMs?, { dispatcher? })` passes `dispatcher` to `fetch` on every request. `DefaultEasClient` passes none.
- New `fetchEasModelSchemas(models)` asks EAS in one request for the model schemas (`bytes32 <name>`) every `{ name, level }` can match at its nameMatch level, and `matchEasModelSchemas(schemas, models)` says which model each is for and at which tier. `getEasModelSchemasForNames` does both. `modelSchemaDefinition(name)` is `bytes32 <easName>`.
- `getEasSchemaUidForSchemaDefinition` looks the exact definition up (`getEasSchemaUidForExactDefinition`) after its cache. It asked for a schema whose definition ended with the snake-cased text.
- `isEasEmptyValue(easType, value)` says whether an attested value is the empty value Seed attests for a removed property: `''` for a `string`, a zero `bytes32` (ADR 0021).
- `getItemVersionsFromEas` returns only Version attestations (`schemaId` is `VERSION_SCHEMA_UID`). It returned every attestation whose `refUID` was one of the seeds, and PublishedBy sidecars use seed uids as `refUID`: a sidecar from the seed's own attester, being newer, was taken as the seed's latest version, and `@seedprotocol/query` assembled the record with no properties. `getCanonicalItemPropertiesFromEas` applies the same filter when it fetches the versions of the properties it checks, so a property on a non-version attestation no longer counts.
- New exports `VERSION_SCHEMA_UID` and `VERSION_SCHEMA_DEF`, moved from `@seedprotocol/sdk`, which re-exports both (and the deprecated `VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA`) unchanged.
- Per-request timing log under the `debug` namespace `seedEas:timing`, off by default: set `DEBUG=seedEas:timing` (Node) or `localStorage.debug = 'seedEas:timing'` (browser), alongside `seedSdk:timing` if you use it. Each indexer request through `createEasGraphQLClient` or `DefaultEasClient` logs `request <operation> <id.in/refUID.in lengths> rows=<n> bytes=<n> <ms>ms`, timed from send until the body is parsed. Each query-client lookup in the api helpers (`getItemVersionsFromEas`, `getSeedsBySchemaName` and the rest) logs `fetchQuery <key> network|deduped|cache <ms>ms`: `deduped` means it waited on the same request already in flight, `cache` that the query client answered without a request.

### Breaking

- Removed `fetchEasSchemaUidBySchemaName` and `getEasSchemaUidBySchemaName`. Look a property schema up by its full definition with `getEasSchemaUidForExactDefinition`, and model schemas with `fetchEasModelSchemas`.

### Commits

#### Features

- per-request timing log under DEBUG=seedEas:timing (a4ce6c3e)

#### Fixes

- load node:module through process.getBuiltinModule (8217b0fb)
- fetch only Version attestations as a seed's versions (a631a084)

#### Other

- Node EAS requests use an undici Agent with X25519:P-256 and 30 s keep-alive (3fccb72f)
- sdk: one EAS model-schema lookup and one model_uids rule (02e732aa)
- Clear a property: clear() and clear({ retract: true }) (ADR 0021) (fdd7e375)

## 0.7.8 (2026-10-20)

- `DefaultEasClient` requests abort after `EAS_REQUEST_TIMEOUT_MS` (30 s). `createEasGraphQLClient(url, timeoutMs?)` builds a client with that limit.
- `setSchemaUidForSchemaDefinition` and `setSchemaUidForModel` forget only the cached lookup misses the schema answers (the same definition, a schema name it ends with, or that model). They cleared every cached miss.

### Commits

#### Fixes

- type the timeout fetch without DOM lib types (25375fee)

#### Other

- sdk: saves and creates read EAS schema UIDs from the lookup cache (ec022380)

## 0.7.6 (2026-10-17)

### Commits

#### Breaking

- vite: cut seedVitePlugin defaults to what the SDK needs (5312b28d)

#### Fixes

- sdk: publish properties under the schema for their exact definition (0de66bb5)

## 0.7.5 (2026-10-17)

- `decodeEasNumber(value)` turns an indexer value (JSON number, decimal or hex string, bigint, or `{ type: 'BigNumber', hex }`) into its decimal string, and `isNumericEasType` says whether an EAS type is `uint*` or `int*` (ADR 0010).
- **`getCanonicalItemPropertiesFromEas` checks attesters by default:** a version counts only if its seed's attester made it, and a property only if its version's attester did. It makes two more requests (the versions and their seeds); pass `checkAttesters: false` when the versions are already trusted.

### Commits

#### Features

- decodeEasNumber reads uint, int, string and BigNumber hex values (cf998ae1)
- nameMatch level helpers; exact means the published name (ac8b8c07)

#### Fixes

- getCanonicalItemPropertiesFromEas checks attesters by default (e2fbdba3)
- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: add READMEs for react, vite, arweave, eas (baf86652)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

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
