# @seedprotocol/feed

Generates **RSS 2.0**, **Atom**, and **JSON Feed** from Seed items. Item assembly (Seed → Version → canonical properties, relation expand, Arweave rich-text hydrate) is provided by [`@seedprotocol/query`](../query); this package applies feed defaults (`link` / `guid` / `pubDate`) and serializes RSS/Atom/JSON Feed. For EAS-assembled feeds, relation fields are marked with `_feedFieldStorageModels` / `_feedListElementStorageModels` so `pickFeedItemContent` prefers **html** / **file** / **json** storage relations before the legacy `html` / `body` / `content` chain; feed output is **not** sanitized—see [FEED_RICH_FIELDS.md](../../docs/FEED_RICH_FIELDS.md) (including **Publishing feeds** and trust boundaries).

## P2P distribution

HTTP hosting is optional. To publish the same generated feeds onto Hyperdrive / Hyperswarm (and serve them to classic RSS readers over localhost), use **`@seedprotocol/feed-hyper`** and the `seed feed` CLI. See [packages/feed-hyper/README.md](../feed-hyper/README.md) and [docs/FEED_HYPER.md](../../docs/FEED_HYPER.md).

Channel self-links use `feedUrl` from site config (`setSiteConfig` / `createFeed` overrides). Home/channel links use `siteUrl`.

## Configuration

### Revoked attestations

Revoked attestations are excluded from feed queries by default. Items that have been unpublished (`item.unpublish()`) will not appear in feeds or discovery.

### Caching (dev mode)

In development (`NODE_ENV=development`), caching is **disabled by default**. Set `CACHE_ENABLED=true` to enable in dev. Assembled Seed JSON (collection/item) is cached by [`@seedprotocol/query`](../query); this package caches serialized feed bodies, HTTP ETags, and image metadata. See `packages/feed/src/cache/README.md` and the query README.

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

When unset, the default primary gateway is `ar.seedprotocol.io`.

**Read fallbacks** (image metadata probing, gateway health checks) use additional public gateways. To override the fallback list:

- `ARWEAVE_READ_GATEWAYS` or `NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS` — comma-separated hostnames
- `IMAGE_METADATA_GATEWAYS` — comma-separated hostnames for RSS image dimension detection

When a custom primary gateway is configured, `ar.seedprotocol.io` is omitted from automatic fallbacks (unless you include it explicitly in one of the env lists above).

**Note:** Items already stored with full `https://ar.seedprotocol.io/...` URLs are passed through unchanged. Only newly resolved transaction IDs use the configured gateway.

### Feed Item URLs (EASScan attestation links)

Item links in the feed can point to EASScan attestation pages. Set these environment variables:

- `FEED_ITEM_URL_BASE` - Base URL for attestation links. Item URLs use `{base}/attestation/view/{uid}`. Default: `https://easscan.org`. Set to override.
  - **Testnet**: `https://optimism-sepolia.easscan.org`
  - **Mainnet**: `https://easscan.org` (default)
- `FEED_ITEM_URL_PATH` - Path segment (default: `attestation/view`). Only used when `FEED_ITEM_URL_BASE` is set.
- `FEED_SITE_URL` - Site URL for fallback when `FEED_ITEM_URL_BASE` is unset (default: `https://seedprotocol.io`).

### Example .env

```bash
# Arweave gateway for feed media / relation URLs
ARWEAVE_HOST=arweave.net

# Default: item links use https://easscan.org/attestation/view/{uid}
# Override for testnet:
FEED_ITEM_URL_BASE=https://optimism-sepolia.easscan.org
FEED_ITEM_URL_PATH=attestation/view
```

---

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
