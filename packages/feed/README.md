# @seedprotocol/feed

## Configuration

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
