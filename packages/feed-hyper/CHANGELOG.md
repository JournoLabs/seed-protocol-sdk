# Changelog — @seedprotocol/feed-hyper

## 0.7.1 (2026-10-10)

### Commits

#### Features

- gateway-hyper: ship seed-feed and seed-gateway bins (aca397d2)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)

## 0.5.1 (2026-08-29)

- `serveFeed` accepts both drive paths (`/posts/rss.xml`) and historical HTTP paths (`/posts/rss`, `/posts/atom`, `/posts/json`).

### Commits

#### Features

- add Hyperdrive publish/open/seed/serve package (690787ed)

#### Other

- feed: depend on eas and arweave instead of full sdk (eb10157f)

## 0.5.0

- Initial release: publish Seed feeds into Hyperdrive, seed via Hyperswarm, serve over localhost HTTP (`serve-drive`).
- CLI: `seed feed publish|seed|serve` (via `@seedprotocol/cli`).
- Drive layout: `/registry.json`, `/{collection}/rss.xml|atom.xml|feed.json`.
- Re-exports `DEFAULT_SEED_FEED_HYPER_KEY` from `@seedprotocol/sdk`.
