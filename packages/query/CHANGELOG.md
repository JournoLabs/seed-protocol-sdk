# Changelog

All notable changes to this package are documented in this file.

## 0.7.4 (2026-10-15)

### Commits

#### Fixes

- eas, sdk: only a seed's attester can add its versions and properties (73e23776)
- throw when clients are registered on another copy of eas/arweave (aec6c2e7)

## 0.7.3 (2026-10-14)

### Commits

#### Features

- arweave: one read-side seam for Arweave content (8b84c616)

#### Fixes

- use already-registered EAS/Arweave clients instead of loading /node (005e192f)

## 0.7.2 (2026-10-11)

### Commits

#### Features

- freeze cached records outside production and type them read-only (7088617e)

#### Other

- overlap EAS requests that don't depend on each other (92d7aa66)

## 0.7.1 (2026-10-10)

### Commits

#### Features

- look up seeds of a schema by uid prefix (2d8d129d)

#### Fixes

- check cache hits for changes instead of rebuilding or going stale (5ec227f7)

#### Other

- hydrate Arweave bodies in parallel and cache them by tx id (c512d9bf)
- eas: drop the slow schema-name join from attestation reads (b0fcdb37)

## 0.7.0 (2026-10-08)

### Commits

#### Fixes

- leave out seeds whose versions are all revoked, in both sources (fa843e09)

#### Other

- sdk: delete dead fromCallback actors and fix waitForDb's interval leak (c06683c6)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Fixes

- publish: attest list relations under one EAS name (55d6cbe2)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Keep Node builtins and CJS keccak off the Seed browser graph. (3bc60ae1)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- share sync parse/canonical helpers and close related pickLatest gap (e5729faa)
- add local/remote/auto source adapters for Seed JSON reads (009fac0e)
- add Version changelog on getSeed via include options (4691fb6b)
- lift collection and item caching from feed (bd71aa60)
- add remote canonical Seed JSON package and rewire feed (65db70b6)
