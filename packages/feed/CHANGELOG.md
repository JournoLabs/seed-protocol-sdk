# Changelog

All notable changes to this package are documented in this file.

## 0.7.5 (2026-10-17)

### Commits

#### Fixes

- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: audit feed, feed-hyper, gateway-hyper, mapping, publish, query READMEs (1a5d7ee4)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.4 (2026-10-15)

### Commits

#### Other

- design docs and READMEs agree with the code (749df1a6)

## 0.7.3 (2026-10-14)

### Commits

#### Fixes

- query: use already-registered EAS/Arweave clients instead of loading /node (005e192f)

## 0.7.1 (2026-10-10)

### Commits

#### Fixes

- stop feed defaults mutating query cache records (d1d16f67)
- query: check cache hits for changes instead of rebuilding or going stale (5ec227f7)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Features

- sdk: record the EAS chain in the local DB and refuse cross-chain writes (7d8af9d5)

#### Other

- Lots of bug fixes (a3a7f146)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Add Arweave gateway circuit breaker for probe and image fetches. (8f572026)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- query: lift collection and item caching from feed (bd71aa60)
- emit media URLs for Image relations, not EAS links (339baf07)
- arweave: prefer proxyBaseUrl as http-proxy gateway path (13775b17)
- query: add remote canonical Seed JSON package and rewire feed (65db70b6)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- resolve Arweave gateway from env at platform init (14db965c)
- resolve image metadata via gateway sidecar when active (5fc656af)
- use feedUrl for document self-links (9b10a636)

#### Other

- depend on eas and arweave instead of full sdk (eb10157f)

## 0.5.0

### Changed

- Depends on `@seedprotocol/eas` and `@seedprotocol/arweave` instead of `@seedprotocol/sdk`.
- `initializeSeedClient` now registers lean EAS/Arweave Node platforms (no full SDK client init).
