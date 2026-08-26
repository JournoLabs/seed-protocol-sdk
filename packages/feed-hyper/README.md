# @seedprotocol/feed-hyper

Publish Seed Protocol RSS/Atom/JSON feeds into a **Hyperdrive**, announce them on **Hyperswarm**, and serve them to ordinary RSS readers over localhost HTTP.

`seed feed serve` accepts both drive paths (`/posts/rss.xml`) and historical HTTP paths (`/posts/rss`).

Generation stays in [`@seedprotocol/feed`](../feed). This package is transport only (Node 20+). It pulls in Holepunch native modules (`sodium-native`, etc.).

## Trust model

- A feed’s identity is its **Hyperdrive public key** (z32), not a hostname.
- Bytes are signed by that key. Peers and HTTP gateways are interchangeable mirrors.
- `https://feed.seedprotocol.io` (or any `seed feed serve` process) is a **convenience gateway**, not the source of truth.
- Official Seed feeds will use `DEFAULT_SEED_FEED_HYPER_KEY` once ops publish and back up the first keypair (empty string until then).

## Drive layout

```
/registry.json
/{collection}/rss.xml
/{collection}/atom.xml
/{collection}/feed.json
/{collection}/archive/{year}/{month}/rss.xml   # when includeArchives
```

`registry.json` lists schemas, formats, the drive key, and last update metadata.

## Install

```bash
bun add @seedprotocol/feed-hyper
```

Requires a toolchain that can build Holepunch native addons.

## Library API

```ts
import {
  publishFeed,
  openFeed,
  seedFeed,
  serveFeed,
  localFeedUrl,
  DEFAULT_SEED_FEED_HYPER_KEY,
} from '@seedprotocol/feed-hyper'

const session = await publishFeed({
  schemas: ['post'],
  formats: ['rss', 'atom', 'json'],
  storePath: '.seed/feed-store',
  announce: true, // keep swarm joined until session.close()
})

console.log(session.key, session.hyperUrl)

const opened = await openFeed({
  key: session.key,
  storePath: '.seed/feed-reader',
})
const rss = await opened.get('/posts/rss.xml')

const gateway = await serveFeed({
  key: session.key,
  storePath: '.seed/feed-reader',
  port: 8080,
})
console.log(localFeedUrl(gateway.baseUrl, 'post', 'rss'))
```

### Fixtures / tests

Pass `fixtureContents: { '/posts/rss.xml': '...' }` to `publishFeed` to skip EAS generation.

## CLI (via `@seedprotocol/cli`)

```bash
seed feed publish --schema post --format rss,atom,json --store .seed/feed-store
seed feed seed <key> --store .seed/feed-store
seed feed serve <key> --port 8080 --host 127.0.0.1
```

Use `--no-announce` on publish/serve to stay offline (local store only).

## Operator notes

1. Back up the Corestore directory for any key you care about (especially the official key).
2. Run at least one always-on `seed feed seed <key>` (or leave `publish` announcing) so cold feeds resolve.
3. Point RSS apps at `http://127.0.0.1:8080/posts/rss.xml` or `http://127.0.0.1:8080/posts/rss` after `seed feed serve`.
4. Unpublish/revocation: regenerating omits revoked items from the **current** drive version; Hypercore history retains prior versions.

See [docs/FEED_HYPER.md](../../docs/FEED_HYPER.md) for the full runbook and manual validation checklist.

## Tests

Path tests always run. Native Corestore/Hyperdrive/HTTP tests run when `FEED_HYPER_TESTS=1` or when not in CI (`FEED_HYPER_TESTS=0` to skip).

```bash
cd packages/feed-hyper && bunx vitest run
FEED_HYPER_TESTS=1 bunx vitest run
```

**Runtime note:** Holepunch natives are intended for **Node.js**. Running them under Bun may crash (`uv_get_osfhandle`). Prefer `node` / `tsx` for CLI and Vitest (which uses Node) for tests.

## Manual validation checklist

See [docs/FEED_HYPER.md](../../docs/FEED_HYPER.md).