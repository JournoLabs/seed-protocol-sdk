# Changelog

All notable changes to this package are documented in this file.

## 0.7.10 (2026-10-24)

### Commits

#### Fixes

- build: pin @types/bun to 1.4.3 (0dd3ed34)

## 0.7.9 (2026-10-22)

- Page 1 of a feed asks `@seedprotocol/query` on every request and rebuilds its cached body only when query's collection ETag changed, so new and changed posts appear on the next request instead of up to `CACHE_TTL` (an hour) later. Each request costs one round of indexer requests when query's collection is cached, none within `CACHE_MAX_AGE`. Page 1's `Cache-Control` max-age and s-maxage are now `CACHE_MAX_AGE` (default 0) instead of 3600, so clients and CDNs revalidate and get a 304 when nothing changed.
- Feed ETags no longer change when an unchanged feed is rebuilt: page 1's comes from query's collection ETag, later pages' and archives' from the body. Before, every rebuild (each TTL) produced a new ETag.
- A cached body is only served for the same site config overrides and cache-bust value it was built with. Before, a `handleFeedRequest` call with other `siteConfigOverrides` could get another site's cached body.
- Archive feeds fall back to their last cached body when building fails, like the main feed; the fallback sends `Warning: 110` and `X-Cache: STALE`.
- `fetchFeedItemsBySchemaName` returns the items with query's collection ETag.
- Archive months are UTC, matching `queryBySchemaForMonth`: the main feed's `prev-archive` link and an archive's `next-archive` link are computed in UTC rather than server-local time.
- Image metadata for items of schemas other than `image` comes from the image their enclosure uses (a feature or cover image whose Arweave URL lacks its size or type), not from the item's own storage transaction, which for a post is its HTML body. `image` items still use their own storage transaction. A cold feed probes one transaction per item with an image instead of one per item.
- Breaking: `FEED_SITE_URL` is removed. It had no effect: item links always use `FEED_ITEM_URL_BASE` or its default (the chain's EAS explorer, else `https://easscan.org`). `loadFeedConfig()` no longer returns `siteUrl`, and `TransformOptions` drops `siteUrl` and requires `itemUrlBase` and `itemUrlPath`. The site config's `siteUrl` (channel links) is unchanged.
- `initializeFeedPlatform` is `initializeQueryPlatform`: it keeps EAS and Arweave clients a host app or the SDK already registered and registers the Node ones otherwise. Before, it replaced them with Node clients on every first call. Breaking: `initializeSeedClient`, `getClient` and `teardownSeedClient` are removed; `teardownFeedPlatform` replaces the last.
- Breaking: `FEED_EXPAND_RELATIONS` is removed and feeds always assemble with `relations: 'expand'`. Setting it to `false` fetched the same related seeds but left Image and author relations as seed UIDs, so items lost their image enclosures and author names. `loadFeedConfig()` no longer returns `expandRelations`.
- A feed body read back from the disk cache keeps its ETag and expiry. Before, loading it into memory gave it a new ETag (so the next `If-None-Match` missed) and a full `CACHE_TTL`, including page 2+ and archive entries that should expire after `CACHE_PAGE_TTL` / `CACHE_ARCHIVE_TTL`.
- Image metadata probes stop at the first gateway that answers, image or not; only an error or a non-ok status moves to the next gateway. When no gateway answers, nothing is cached and the next request probes again; before, the transaction was cached as "not an image" for `IMAGE_METADATA_TTL` (7 days). `ArweaveImageService.detectImage` returns null in that case.
- Image metadata is cached whenever `IMAGE_METADATA_ENABLED` is on, including when content caching is off (the development default), and at most 8 probes run at once.
- Archive feeds get image metadata (enclosure size and dimensions) like the main feed.
- A page whose last item fills it exactly no longer links a `next` page that would be empty: the handler fetches one item past the page to tell.
- `FEED_PAGE_SIZE` that isn't a positive integer gives the default 25 instead of `NaN`.
- The cache config is read once per process instead of on every request, and per-request logs (cache hits and misses, item counts, image probes) only print under `DEBUG=seedFeed`.
- Breaking: `GraphQLItem` (use `FeedItem`), `enrichImageSeedCloneForFeed`, `FEED_RICH_BODY_STORAGE_SCHEMAS` and `isFeedRichBodyStorageSchema` are no longer exported. Import `enrichImageSeedClone`, `RICH_BODY_STORAGE_SCHEMAS` and `isRichBodyStorageSchema` from `@seedprotocol/query`.
- `FeedItem` names the feed entry type. `GraphQLResponse` and the Express `Request`, `Response` and `ApiHandler` types are removed (none were exported from the package).
- `express`, `@types/express` and `graphql-request` are no longer dependencies.
- `CACHE_BACKGROUND_REFRESH` and `CACHE_REFRESH_INTERVAL` are no longer read; they never did anything.

### Commits

#### Breaking

- remove FEED_SITE_URL and the item-link branches it fed (a74c5944)
- start up through query, keep registered clients (091446a2)
- drop FEED_EXPAND_RELATIONS, always expand relations (583dc993)
- query: remove deprecated aliases (dfe0c27e)

#### Features

- key cached feed bodies on query's collection ETag (c8005844)
- query: relations option with a uids mode that skips related seeds (57e6c5fd)

#### Fixes

- query: register NodeEasClient on Node when no EAS client is set (788627f6)
- query: monthly archives use UTC month bounds (7fce0a25)
- probe the enclosure image, not the item's own transaction (eb5f6a9e)
- cache, image probe and pagination fixes from the audit (cb1ee8dc)

#### Other

- correct env var and rich-field docs (803c2bfc)
- import query helpers directly, FeedItem type, drop unused deps (a3079128)

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
