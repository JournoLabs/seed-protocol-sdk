# Gateway Hyper (P2P infrastructure tunnel)

Tunnel a local **seed-protocol-server + ar.io gateway** stack to SDK users over **HyperDHT**, with optional localhost HTTP sidecar for apps and browsers.

Generation and bundler logic stay in `seed-protocol-server`. This repo adds transport only (`@seedprotocol/gateway-hyper` + SDK config).

See [GATEWAY_HYPER_SERVER_HANDOFF.md](./GATEWAY_HYPER_SERVER_HANDOFF.md) for optional changes on the server team.

## Concepts

| Concept | Role |
|---------|------|
| Operator key (z32) | Stable infrastructure identity (operator Ed25519 public key) |
| `seed gateway tunnel serve` | Operator: proxy Hyper connections → Traefik/upstream HTTP |
| `seed gateway tunnel connect` | Client: dial operator key → `http://127.0.0.1:1984` sidecar |
| `DEFAULT_SEED_GATEWAY_HYPER_KEY` | Well-known official operator key (empty until ops publish one) |

HTTP hostnames are convenience. Clients that only trust a hostname without the operator key are trusting DNS/TLS.

## Developer tiers

1. **HTTP on-prem** — `transport: 'http-gateway'`, point `arweaveDomain` / `uploadApiBaseUrl` at your LAN or Tailscale URLs.
2. **Hyper sidecar** — run `seed gateway tunnel connect <key>`; set `transport: 'hyper'` in seed.config.
3. **Hybrid (recommended early cohort)** — `transport: 'hybrid'`: try sidecar first, fall back to HTTP gateways.
4. **Library** — `import { serveTunnel, connectTunnel } from '@seedprotocol/gateway-hyper'`.

## seed.config.ts

```typescript
import { DEFAULT_SEED_GATEWAY_HYPER_KEY } from '@seedprotocol/sdk'

export const gateway = {
  transport: 'hybrid' as const,
  arweaveDomain: 'ar.seedprotocol.io',
  uploadApiBaseUrl: 'https://app.seedprotocol.io',
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
4. Each SDK user runs:

   ```bash
   seed gateway tunnel connect <z32-key> --port 1984
   ```

5. App uses `transport: 'hyper'` or `'hybrid'` with that key in config.

## Developer key swap

Each developer runs their own `seed gateway tunnel serve`, puts their z32 in `gateway.gatewayHyperKey`, and shares the key with their app's users for `seed gateway tunnel connect`.

## Browser note

Browsers cannot run Holepunch natives. Run the client sidecar locally; the app talks to `http://127.0.0.1:1984`.

## CI / tests

- `@seedprotocol/gateway-hyper` unit tests always run.
- DHT loopback integration: `GATEWAY_HYPER_TESTS=1 bun run test` in `packages/gateway-hyper`.
- SDK resolver tests use a mock HTTP sidecar (no natives required).

Prefer **Node.js** for gateway-hyper (Bun may crash on Holepunch N-API).

## Manual validation

1. Operator: docker stack + `seed gateway tunnel serve`.
2. Client: `seed gateway tunnel connect <key>`.
3. `curl http://127.0.0.1:1984/info` (or your gateway's health path).
4. Publish via app; confirm `GET /raw/{txId}` through sidecar serves new uploads immediately.
