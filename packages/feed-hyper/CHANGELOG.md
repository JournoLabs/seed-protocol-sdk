# Changelog — @seedprotocol/feed-hyper

## Unreleased

- `serveFeed` accepts both drive paths (`/posts/rss.xml`) and historical HTTP paths (`/posts/rss`, `/posts/atom`, `/posts/json`).

## 0.5.0

- Initial release: publish Seed feeds into Hyperdrive, seed via Hyperswarm, serve over localhost HTTP (`serve-drive`).
- CLI: `seed feed publish|seed|serve` (via `@seedprotocol/cli`).
- Drive layout: `/registry.json`, `/{collection}/rss.xml|atom.xml|feed.json`.
- Re-exports `DEFAULT_SEED_FEED_HYPER_KEY` from `@seedprotocol/sdk`.
