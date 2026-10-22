# Feed cache (content + image metadata)

This package caches **serialized** RSS / Atom / JSON Feed bodies and Arweave **image metadata** for enclosure enrichment.

**Collection / item (assembled Seed JSON) caching** lives in [`@seedprotocol/query`](../../query) — see that package’s README. Feed calls `queryBySchema` on content miss; query owns TTL, incremental merge, and refresh locks for assembled records.

## Environment Variables

Shared with `@seedprotocol/query` for enablement and TTL:

- `CACHE_TTL` - Content TTL in seconds (default: 3600 = 1 hour); also used by query for collection/item TTL
- `CACHE_DIR` - Directory for persistent cache files (default: `./cache`)
- `CACHE_ENABLED` - Enable/disable caching. In development (`NODE_ENV=development`), cache is disabled by default. Set to `true` to enable in dev, or `false` to disable in production.
- `CACHE_PAGE_TTL` - TTL for paginated content keys page > 1 (default: 300)
- `CACHE_ARCHIVE_TTL` - TTL for monthly archive content (default: 86400)

Image metadata:

- `IMAGE_METADATA_ENABLED` - default true
- `IMAGE_METADATA_TTL` - default 604800 (7 days)
- `IMAGE_METADATA_GATEWAYS` / `IMAGE_METADATA_TIMEOUT`

## How It Works

Each cached body records a fingerprint of what it was built from: query's collection ETag (page 1), the resolved site config and the cache-bust value. A body is served only while the fingerprint still matches.

1. **Page 1** — every request calls `@seedprotocol/query` first (one round of indexer requests when its collection is cached, none within `CACHE_MAX_AGE`). If the collection ETag is unchanged, the cached body is returned (or 304); otherwise items are enriched with image metadata, `createFeed` builds the body, and it is stored. The response ETag is derived from the collection ETag, so it stays the same across rebuilds of an unchanged feed, and `Cache-Control` max-age is `CACHE_MAX_AGE` (default 0: clients revalidate every time and get a 304 when nothing changed).
2. **Page > 1 and archives** — the cached body is served without asking query until `CACHE_PAGE_TTL` / `CACHE_ARCHIVE_TTL` ends; the ETag is a hash of the body.
3. **Errors** — if building fails, an unexpired cached body for the same URL is served with `X-Cache: STALE`.

Image metadata changes alone do not change a page 1 body's fingerprint; the body picks them up on its next rebuild.

## Cache Storage

- **Memory** — active content + image metadata
- **Files** — `{schema}-{format}.json`, page/archive variants, `image-metadata/{txId}.json`

Do not confuse with query’s `collections/` and `items/` subdirectories in the same `CACHE_DIR`.

## HTTP Conditional Requests

- `ETag` / `If-None-Match` → 304
- `Last-Modified` / `Cache-Control` on responses; `X-Cache` is `HIT`, `MISS` or `STALE`
