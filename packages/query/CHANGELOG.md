# Changelog

All notable changes to this package are documented in this file.

## 0.7.11 (2026-10-24)

### Commits

#### Fixes

- eas, sdk: one store for property schema uids, read by every resolver (0ea6562b)

## 0.7.10 (2026-10-24)

### Commits

#### Fixes

- build: pin @types/bun to 1.4.3 (0dd3ed34)

## 0.7.9 (2026-10-22)

- On Node, `initializeQueryPlatform` registers `NodeEasClient` when no EAS client is registered, as it already did for the Arweave client. Before, a process that used query without the SDK got `DefaultEasClient`, which doesn't use `NodeEasClient`'s TLS and keep-alive settings, so every new connection to easscan on Node 24.21+ paid the ~1.45 s handshake.
- `queryBySchemaForMonth` bounds the month in UTC on both the remote and the SDK's local source. Before, it used the server's local time zone, so an archive's contents depended on `TZ`, and seeds created near a month edge can move to the neighbouring month.
- Breaking: the deprecated aliases are removed. `expandRelations` is gone (use `relations: 'expand'` or `'urls'`), as are `FEED_RICH_BODY_STORAGE_SCHEMAS`, `isFeedRichBodyStorageSchema`, `feedRichBodyModelPriority`, the `get`/`setFeed…StorageModel(s)` functions and `Feed…StorageModels` types, `enrichImageSeedCloneForFeed`, `hydrateArweaveRichTextInFeedItems`, `parseEasPropertyMetadataForFeed` and its two `…ForFeed` types, and `QueryCacheConfig.backgroundRefresh` / `refreshInterval`. Each had a non-`Feed` name that is unchanged.
- `CACHE_BACKGROUND_REFRESH` and `CACHE_REFRESH_INTERVAL` are no longer read. Neither was ever used.
- A property whose attestation is a removal (`''` for a `string`, a zero `bytes32`; ADR 0021) is left out of the assembled seed, and a zero `bytes32` is never fetched as a related seed. Before, query kept `''` and the zero uid as values and looked the zero uid up. The changelog reports a removal as a change to `undefined`, and version snapshots leave the property out.
- `relations: 'expand' | 'urls' | 'uids'` on every assemble option set (default `'expand'`) replaces `expandRelations` (`true` was `'expand'`, `false` was `'urls'`). `'uids'` is new: relation values stay seed UIDs under their stored keys and no related seeds, versions or properties are fetched, so a cold `queryBySchema` makes three indexer requests instead of up to seven. A `'uids'` record's cache entry depends only on its seed and head version, so a change to a related seed doesn't invalidate it. Its cache key is `e2-…`; `'expand'` and `'urls'` keep the `e1-…` and `e0-…` keys `expandRelations` used.
- A warm `queryBySchema` read is one round of indexer requests instead of two: the change check on the cached collection goes out alongside the seed list rather than after it. It checks every cached seed, listed or not, and no longer asks whether the listed seeds themselves were revoked, since the seed list already leaves revoked seeds out. Related seeds are still checked for revocation.
- `queryBySchema(schemaName, { maxAge })` returns a collection checked less than `maxAge` seconds ago in this process without any request. Off by default; `CACHE_MAX_AGE` sets a default for every call. New, changed and revoked seeds show up to `maxAge` seconds late. Applies where the collection cache does (remote, `skip` 0, no `uidPrefix`).

### Commits

#### Breaking

- feed: remove deprecated aliases (dfe0c27e)

#### Features

- opt-in maxAge window for cached collections (514f5e97)
- relations option with a uids mode that skips related seeds (57e6c5fd)

#### Fixes

- register NodeEasClient on Node when no EAS client is set (788627f6)
- feed: monthly archives use UTC month bounds (7fce0a25)
- eas: fetch only Version attestations as a seed's versions (a631a084)

#### Other

- feed: import query helpers directly, FeedItem type, drop unused deps (a3079128)
- send the collection change check alongside the seed list (fdb38985)
- Clear a property: clear() and clear({ retract: true }) (ADR 0021) (fdd7e375)

## 0.7.6 (2026-10-17)

- `getSeeds(seedUids, options)` reads many seeds, of any schemas, in one set of indexer requests and returns a `Map` keyed by UID as given. It takes the `getSeed` assemble options (no changelog) and `pins`, and shares the item cache with `getSeed`.
- `getSeed(seedUid, { versionUid, asOf })` reads a seed at one of its versions, with relations expanded and storage hydrated as for the latest, and returns null when the seed has no such version. `asOf` leaves out attestations made after it; a `patch` publish adds property attestations to the current version, so a version uid alone shows later patches (ADR 0011).
- `queryBySchema`, `queryBySchemaForMonth` and `getSeed` return only the seeds asked for. Before, a seed related to one of them that had the same schema (a post linking to another post) came back as an extra record, past `limit`, with its own relations unexpanded, and that record went into the item cache.

### Commits

#### Features

- getSeed versionUid/asOf, and getSeeds for many seeds at once (cf8c9f71)
- assemble a seed at a pinned version, optionally as of a time (21b3f94e)

#### Fixes

- return only requested seeds, not same-schema related ones (3244561e)

#### Other

- reword getUnchangedCachedItems comment (3bacd9ff)
- getSeeds, version reads, ADR 0011 (a058aef3)
- assemble seeds of mixed schemas in one pass (38dba73b)

## 0.7.5 (2026-10-17)

- Values from `uint*` and `int*` property attestations come back as decimal strings. Before, `uint256` and other wide integers came back as the indexer's `{"type":"BigNumber","hex":…}` JSON (ADR 0010).

### Commits

#### Fixes

- decode integer property values to decimal strings (e8ca5d94)
- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: audit feed, feed-hyper, gateway-hyper, mapping, publish, query READMEs (1a5d7ee4)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

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
