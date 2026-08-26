# Feed Hyper (P2P distribution)

This document describes how Seed Protocol feeds are distributed over Hyperdrive / Hyperswarm via `@seedprotocol/feed-hyper` and the `seed feed` CLI.

Generation remains in `@seedprotocol/feed`. Pear desktop apps are out of scope here.

## Concepts

| Concept | Role |
|---------|------|
| Hyperdrive key (z32) | Stable feed identity (publisher-signed) |
| Corestore path | Local durable storage for cores/drives |
| Hyperswarm | Peer discovery + replication |
| `seed feed serve` | Localhost HTTP gateway for classic RSS readers |
| `DEFAULT_SEED_FEED_HYPER_KEY` | Well-known official Seed feed key (filled by ops after first release) |

HTTP gateways do **not** replace key verification. A client that only fetches HTTPS without the key is trusting the gateway; a client that holds the key verifies signatures regardless of who served the bytes.

## Developer tiers

1. **Gateway only** — consume `https://feed.seedprotocol.io/...` (or a future hyper-backed gateway). No Hypercore required.
2. **Local sidecar** — run `seed feed serve <key>` and point the app at `http://127.0.0.1:8080/...`.
3. **Node library** — `import { openFeed, publishFeed } from '@seedprotocol/feed-hyper'`.
4. **Pear app** — deferred; ships separately.

## Operator runbook

### First official publish

1. On a secure host, run:

   ```bash
   seed feed publish --schema post --format rss,atom,json --store /var/seed/feed-store
   ```

2. Record the printed z32 key. Back up `/var/seed/feed-store` offline.
3. Set `DEFAULT_SEED_FEED_HYPER_KEY` in `@seedprotocol/sdk` and release.
4. Keep the publisher process running (or run `seed feed seed <key>` on a second host).

### Always-on seeder

```bash
seed feed seed <key> --store /var/seed/feed-mirror
```

### Local RSS gateway

```bash
seed feed serve <key> --port 8080 --host 127.0.0.1
# e.g. http://127.0.0.1:8080/posts/rss.xml
#      http://127.0.0.1:8080/posts/rss   (same feed; historical HTTP shape)
```

### Key rotation

Hyperdrive keys are not rotatable in place. Publish a new drive, update `DEFAULT_SEED_FEED_HYPER_KEY` / docs / registry pointers, and keep the old seeder online during migration.

## Revocation / unpublish

`@seedprotocol/feed` excludes revoked attestations when generating. After republish, the **latest** drive version omits those items. Prior Hypercore versions remain in history (append-only). Readers that already synced old versions retain local history unless they only read the tip.

## Manual validation checklist

1. `seed feed publish --schema post --format rss --no-announce` (or with fixtures in tests).
2. Second process: `seed feed seed <key>` then `seed feed serve <key>`.
3. `curl http://127.0.0.1:8080/posts/rss.xml` (or open in NetNewsWire / Reeder).
4. Stop the publisher; seeder should still serve.
5. Republish; seeder’s drive version increases without restart (watch/poll).

## CI notes

Holepunch packages need native build tools. Path-mapping tests always run. Integration tests that open Corestore/Hyperdrive run when `FEED_HYPER_TESTS=1` or when not in CI (`CI` unset). Set `FEED_HYPER_TESTS=0` to skip natives locally.

Prefer **Node.js** (or Vitest’s Node environment) for feed-hyper. Bun may crash on Holepunch N-API (`uv_get_osfhandle`).