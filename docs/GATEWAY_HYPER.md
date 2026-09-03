# Gateway Hyper (P2P infrastructure tunnel)

Tunnel a local **seed-protocol-server + ar.io gateway** stack to SDK users over **HyperDHT**, with optional localhost HTTP sidecar **or** an app-server HTTP proxy for browsers.

Generation and bundler logic stay in `seed-protocol-server`. This repo adds transport only (`@seedprotocol/gateway-hyper` + SDK config).

See [GATEWAY_HYPER_SERVER_HANDOFF.md](./GATEWAY_HYPER_SERVER_HANDOFF.md) for optional changes on the server team.

## Concepts

| Concept | Role |
|---------|------|
| Operator key (z32) | Stable infrastructure identity (operator Ed25519 public key) |
| `seed gateway tunnel serve` | Operator: proxy Hyper connections → Traefik/upstream HTTP |
| `seed gateway tunnel connect` | Client: dial operator key → `http://127.0.0.1:1984` sidecar (Path A) |
| `createGatewayProxy` | App server: dial operator key → Node HTTP handlers for a mount path (Path B) |
| `DEFAULT_SEED_GATEWAY_HYPER_KEY` | Well-known official operator key (empty until ops publish one) |

HTTP hostnames are convenience. Clients that only trust a hostname without the operator key are trusting DNS/TLS.

Browsers **cannot** run Holepunch natives. They always speak plain HTTP to either a local sidecar, an app-server proxy, or a public HTTPS gateway.

## Web apps (Path A vs Path B)

| Scenario | What to run | Web `seed.config` |
|----------|-------------|-------------------|
| Local dev / Electron | `seed gateway tunnel connect <z32>` | `transport: 'hyper' \| 'hybrid'`, sidecar defaults |
| Hosted web app | Node route using `createGatewayProxy` | `proxyBaseUrl: '/api/seed-gateway'` (Hyper key **server-only**) |
| Public HTTP only | nothing | `transport: 'http-gateway'` |

**Hybrid preference:** configured + healthy `proxyBaseUrl` → local sidecar → public HTTP gateway.

### Path A — Local sidecar

Run on the same machine as the browser (or inside Electron):

```bash
seed gateway tunnel connect <z32-key> --port 1984
```

```typescript
export const gateway = {
  transport: 'hybrid' as const,
  arweaveDomain: 'ar.seedprotocol.io',
  uploadApiBaseUrl: 'https://app.seedprotocol.io',
  gatewayHyperKey: DEFAULT_SEED_GATEWAY_HYPER_KEY,
  hyper: {
    localSidecarHost: '127.0.0.1',
    localSidecarPort: 1984,
  },
}
```

### Path B — App-server proxy

Keep the operator Hyper key on the **server**. The browser only gets a same-origin (or absolute) HTTP base URL.

Next.js App Router (Node runtime — **not** Edge):

```ts
import { createGatewayProxy } from '@seedprotocol/gateway-hyper'

const proxy = createGatewayProxy({
  key: process.env.SEED_GATEWAY_HYPER_KEY!,
  mountPath: '/api/seed-gateway',
})

export const GET = (req: Request) => proxy.handleFetch(req)
export const POST = (req: Request) => proxy.handleFetch(req)
export const PUT = (req: Request) => proxy.handleFetch(req)
export const PATCH = (req: Request) => proxy.handleFetch(req)
export const DELETE = (req: Request) => proxy.handleFetch(req)
```

Express / `node:http`:

```ts
import { createGatewayProxy } from '@seedprotocol/gateway-hyper'

const proxy = createGatewayProxy({
  key: process.env.SEED_GATEWAY_HYPER_KEY!,
  mountPath: '/api/seed-gateway',
})

app.use('/api/seed-gateway', (req, res) => proxy.handleNode(req, res))
```

Web app config:

```typescript
export const gateway = {
  transport: 'hybrid' as const,
  proxyBaseUrl: '/api/seed-gateway', // or https://app.example.com/api/seed-gateway
  arweaveDomain: 'ar.seedprotocol.io', // HTTP fallback
  uploadApiBaseUrl: 'https://app.seedprotocol.io',
}
```

Relative `proxyBaseUrl` resolves against `window.location.origin` in the browser. Node/SSR resolution needs an absolute URL or `resolveSeedGatewayEndpoints(config, { origin })`.

**Security:** the proxy is a privileged relay to upload + gateway APIs. Authenticate and rate-limit the route; do not expose an open unauthenticated proxy on the public internet.

Prefer **Node.js** for `@seedprotocol/gateway-hyper` (Bun may crash on Holepunch N-API).

## Developer tiers

1. **HTTP on-prem** — `transport: 'http-gateway'`, point `arweaveDomain` / `uploadApiBaseUrl` at your LAN or Tailscale URLs.
2. **Hyper sidecar** — run `seed gateway tunnel connect <key>`; set `transport: 'hyper'` in seed.config.
3. **App-server proxy** — `createGatewayProxy` + `proxyBaseUrl` (hosted browsers).
4. **Hybrid (recommended early cohort)** — `transport: 'hybrid'`: try proxy, then sidecar, then HTTP gateways.
5. **Library** — `import { serveTunnel, connectTunnel, createGatewayProxy } from '@seedprotocol/gateway-hyper'`.

## seed.config.ts

```typescript
import { DEFAULT_SEED_GATEWAY_HYPER_KEY } from '@seedprotocol/sdk'

export const gateway = {
  transport: 'hybrid' as const,
  arweaveDomain: 'ar.seedprotocol.io',
  uploadApiBaseUrl: 'https://app.seedprotocol.io',
  // Path B (hosted web) — omit gatewayHyperKey from the browser bundle when using this
  proxyBaseUrl: '/api/seed-gateway',
  // Path A (local / Electron)
  gatewayHyperKey: DEFAULT_SEED_GATEWAY_HYPER_KEY, // or your dev operator key
  hyper: {
    localSidecarHost: '127.0.0.1',
    localSidecarPort: 1984,
  },
}
```

Top-level `arweaveDomain` / `uploadApiBaseUrl` still work; `gateway` merges with them.

## Publish bootstrap

Resolve upload + GraphQL URLs once and pass into `initPublish`:

```typescript
import {
  resolveSeedGatewayEndpoints,
  seedGatewayConfigFromSeedConfig,
  initPublish,
} from '@seedprotocol/sdk'
import config from './seed.config'

const gw = await resolveSeedGatewayEndpoints(seedGatewayConfigFromSeedConfig(config))
initPublish({
  uploadApiBaseUrl: gw.uploadApiBaseUrl,
  arweaveGraphqlUrl: gw.arweaveGraphqlUrl,
  useArweaveBundler: true,
  thirdwebClientId: '...',
})
```

## Operator runbook

1. Run `seed-protocol-server` stack (Traefik + gateway + bundler). See server README.
2. On the operator host:

   ```bash
   seed gateway tunnel serve --upstream http://127.0.0.1:80 --key-file ./.seed/gateway-tunnel/operator.key.json
   ```

3. Record the printed z32 key. Set `DEFAULT_SEED_GATEWAY_HYPER_KEY` after ops backup (optional).
4. Each SDK user (Path A) runs:

   ```bash
   seed gateway tunnel connect <z32-key> --port 1984
   ```

   Or each app server (Path B) mounts `createGatewayProxy` with that key.
5. App uses `transport: 'hyper'` or `'hybrid'` (and `proxyBaseUrl` when using Path B).

## Developer key swap

Each developer runs their own `seed gateway tunnel serve`, puts their z32 in `gateway.gatewayHyperKey` (Path A) or `SEED_GATEWAY_HYPER_KEY` on the app server (Path B), and shares the key with their app's users for `seed gateway tunnel connect` when using Path A.

## CI / tests

- `@seedprotocol/gateway-hyper` unit tests always run.
- DHT loopback integration: `GATEWAY_HYPER_TESTS=1 bun run test` in `packages/gateway-hyper`.
- SDK resolver tests use a mock HTTP sidecar / proxy (no natives required).

## Manual validation

1. Operator: docker stack + `seed gateway tunnel serve`.
2. Path A: `seed gateway tunnel connect <key>` then `curl http://127.0.0.1:1984/info`.
3. Path B: mount `createGatewayProxy`, then `curl https://your-app/api/seed-gateway/info`.
4. Publish via app; confirm `GET /raw/{txId}` through the chosen path serves new uploads immediately.
