# @seedprotocol/feed

[![npm](https://img.shields.io/npm/v/@seedprotocol/feed.svg)](https://www.npmjs.com/package/@seedprotocol/feed)

Generates **RSS 2.0**, **Atom**, and **JSON Feed** from Seed items. Item assembly (Seed → Version → canonical properties, relation expand, Arweave rich-text hydrate) is provided by [`@seedprotocol/query`](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/query/README.md); this package applies feed defaults (`link` / `guid` / `pubDate`) and serializes RSS/Atom/JSON Feed. For EAS-assembled feeds, relation fields are marked with `_feedFieldStorageModels` / `_feedListElementStorageModels` so `pickFeedItemContent` prefers **html** / **file** / **json** storage relations before the legacy `html` / `body` / `content` chain; feed output is **not** sanitized—see [FEED_RICH_FIELDS.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/FEED_RICH_FIELDS.md) (including **Publishing feeds** and trust boundaries).

Part of [Seed Protocol](https://seedprotocol.io); pairs with [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk).

## Installation

```bash
npm install @seedprotocol/feed
```

Server-side (Node / Bun). Item assembly comes from `@seedprotocol/query`, which is installed as a dependency.

## Usage

```ts
import { initializeFeedPlatform, handleFeedRequest } from '@seedprotocol/feed'

await initializeFeedPlatform()

// GET /:collection/:format  (format: rss | atom | json)
const response: Response = await handleFeedRequest('posts', 'rss', request.headers.get('if-none-match'))
```

`handleArchiveFeedRequest(collection, year, month, format)` serves RFC 5005 monthly archives. `createFeed(items, schemaName, format)` serializes items you have already fetched (e.g. via `getFeedItemsBySchemaName`).

## P2P distribution

HTTP hosting is optional. To publish the same generated feeds onto Hyperdrive / Hyperswarm (and serve them to classic RSS readers over localhost), use **`@seedprotocol/feed-hyper`** and its `seed-feed` CLI. See [packages/feed-hyper/README.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/feed-hyper/README.md) and [docs/FEED_HYPER.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/FEED_HYPER.md).

Channel self-links use `feedUrl` from site config (`setSiteConfig` / `createFeed` overrides). Home/channel links use `siteUrl`.

## Configuration

### Revoked attestations

Revoked attestations are excluded from feed queries by default. Items that have been unpublished (`item.unpublish()`) will not appear in feeds or discovery.

### Caching (dev mode)

In development (`NODE_ENV=development`), caching is **disabled by default**. Set `CACHE_ENABLED=true` to enable in dev. Assembled Seed JSON (collection/item) is cached by [`@seedprotocol/query`](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/query/README.md); this package caches serialized feed bodies, HTTP ETags, and image metadata. See [packages/feed/src/cache/README.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/feed/src/cache/README.md) and the [query README](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/query/README.md).

### Arweave gateway URLs

Feed generation resolves Arweave transaction IDs to gateway URLs (RSS enclosures, image relations, rich-text hydration). Configure the primary gateway with any of these (first match wins):

- `ARWEAVE_HOST` — server-side (Node, Bun, etc.)
- `NEXT_PUBLIC_ARWEAVE_HOST` — Next.js / universal apps
- `VITE_ARWEAVE_HOST` — Vite apps (also set this for Bun if you use a `VITE_`-prefixed `.env`)

Or pass an explicit domain at init time (takes precedence over env):

```ts
import { initializeFeedPlatform } from '@seedprotocol/feed'

await initializeFeedPlatform({ arweaveDomain: 'arweave.net' })
```

When unset, the default primary gateway is `arweave.net`.

**Read fallbacks** (image metadata probing, gateway health checks) use additional public gateways. To override the fallback list:

- `ARWEAVE_READ_GATEWAYS` or `NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS` — comma-separated hostnames
- `IMAGE_METADATA_GATEWAYS` — comma-separated hostnames for RSS image dimension detection

A custom primary gateway goes first, followed by the default gateways (`arweave.net`, `permagate.io`, `zigza.xyz`, `ar.seedprotocol.io`) unless one of the env lists above replaces them.

Arweave links in items, whether a field holds one or Html contains them, are written on the configured public gateway, so items published with `https://ar.seedprotocol.io/...` links come out on it too.

### Feed Item URLs (EASScan attestation links)

Item links in the feed can point to EASScan attestation pages. Set these environment variables:

- `EAS_CHAIN_ID` - Chain the feed reads attestations from (e.g. `8453` for Base). Sets both the EAS indexer and the default explorer for item links. Default: `11155420` (Optimism Sepolia).
- `FEED_ITEM_URL_BASE` - Base URL for attestation links. Item URLs use `{base}/attestation/view/{uid}`. Default: the EAS explorer of `EAS_CHAIN_ID` (e.g. `https://base.easscan.org`), or `https://easscan.org` for chains without a known explorer.
- `FEED_ITEM_URL_PATH` - Path segment (default: `attestation/view`), used with `FEED_ITEM_URL_BASE` or its default.

### Items and pages

- `FEED_PAGE_SIZE` - Items per page (default: `25`).
- `FEED_INCLUDE_DATA_URI_HTML_ITEMS` - `true` keeps items whose rich text embeds `data:image/` URIs. Default: such items are left out of the feed.
- `CACHE_MAX_AGE` - Seconds a checked collection is served by `@seedprotocol/query` with no indexer request (default `0`). See the [query README](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/query/README.md).

### Example .env

```bash
# Arweave gateway for feed media / relation URLs
ARWEAVE_HOST=arweave.net

# Read Base attestations; item links default to https://base.easscan.org/attestation/view/{uid}
EAS_CHAIN_ID=8453
# Optional override for item links:
# FEED_ITEM_URL_BASE=https://base.easscan.org
FEED_ITEM_URL_PATH=attestation/view
```

## License

MIT
