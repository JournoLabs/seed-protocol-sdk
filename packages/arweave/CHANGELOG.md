# Changelog

All notable changes to this package are documented in this file.

## 0.7.3 (2026-10-14)

### Commits

#### Features

- one read-side seam for Arweave content (8b84c616)

#### Fixes

- sdk: batch Content-SHA-256 lookups and verify downloaded files (c01e41d5)
- query: use already-registered EAS/Arweave clients instead of loading /node (005e192f)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.8 (2026-10-03)

### Commits

#### Other

- Lots of bug fixes (a3a7f146)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Add Arweave gateway circuit breaker for probe and image fetches. (8f572026)

## 0.6.0 (2026-09-22)

### Commits

#### Features

- mapping: add resolve jobs, URL classifier, and AV media roles (ac9ef29c)

## 0.5.3 (2026-09-17)

_Also covers 0.5.2, published from commits in this range._

### Commits

#### Features

- classify EAS explorer URLs and resolve RSS image refs (cd3ae146)
- prefer proxyBaseUrl as http-proxy gateway path (13775b17)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- honor VITE_ARWEAVE_HOST and primary-aware read fallbacks (974c71b7)
- extract Arweave and gateway helpers into @seedprotocol/arweave (3f9060ed)

#### Other

- replace setPlatformClass with instance + static facade (0bca44b7)
- tier1: consolidate remaining GraphQL queries in eas and arweave (2c64d2f1)

## 0.5.0

Initial release: Arweave gateway client, gateway resolution, mediaRef helpers, and Node platform registration.
