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
- `CACHE_BACKGROUND_REFRESH` / `CACHE_REFRESH_INTERVAL` - Reserved (unused)

Image metadata:

- `IMAGE_METADATA_ENABLED` - default true
- `IMAGE_METADATA_TTL` - default 604800 (7 days)
- `IMAGE_METADATA_GATEWAYS` / `IMAGE_METADATA_TIMEOUT`

## How It Works

1. **Content hit** — return cached body (or 304 if `If-None-Match` matches)
2. **Content miss** — `getFeedItemsBySchemaName` → `@seedprotocol/query` (may hit collection cache) → optional image enrich → `createFeed` → store content
3. **Archives / page > 1** — content-only keys with archive/page TTL; no feed-local item list cache

## Cache Storage

- **Memory** — active content + image metadata
- **Files** — `{schema}-{format}.json`, page/archive variants, `image-metadata/{txId}.json`

Do not confuse with query’s `{schema}.json` collection files in the same `CACHE_DIR`.

## HTTP Conditional Requests

- `ETag` / `If-None-Match` → 304
- `Last-Modified` / `Cache-Control` on responses
