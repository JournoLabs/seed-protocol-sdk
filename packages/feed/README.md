# @seedprotocol/feed

Generates **RSS 2.0**, **Atom**, and **JSON Feed** from Seed items. For EAS-assembled feeds, `getFeedItemsBySchemaName` marks relation fields with `_feedFieldStorageModels` / `_feedListElementStorageModels` so `pickFeedItemContent` prefers **html** / **file** / **json** storage relations before the legacy `html` / `body` / `content` chain; feed output is **not** sanitized—see [FEED_RICH_FIELDS.md](../../docs/FEED_RICH_FIELDS.md) (including **Publishing feeds** and trust boundaries).

## Configuration

### Revoked attestations

Revoked attestations are excluded from feed queries by default. Items that have been unpublished (`item.unpublish()`) will not appear in feeds or discovery.

### Caching (dev mode)

In development (`NODE_ENV=development`), feed caching is **disabled by default** so you always see fresh content. Set `CACHE_ENABLED=true` to enable caching in dev. See `packages/feed/src/cache/README.md` for full cache configuration.

### Feed Item URLs (EASScan attestation links)

Item links in the feed can point to EASScan attestation pages. Set these environment variables:

- `FEED_ITEM_URL_BASE` - Base URL for attestation links. Item URLs use `{base}/attestation/view/{uid}`. Default: `https://easscan.org`. Set to override.
  - **Testnet**: `https://optimism-sepolia.easscan.org`
  - **Mainnet**: `https://easscan.org` (default)
- `FEED_ITEM_URL_PATH` - Path segment (default: `attestation/view`). Only used when `FEED_ITEM_URL_BASE` is set.
- `FEED_SITE_URL` - Site URL for fallback when `FEED_ITEM_URL_BASE` is unset (default: `https://seedprotocol.io`).

### Example .env

```bash
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
