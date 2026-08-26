# Gateway Hyper — seed-protocol-server handoff

This document is for **seed-protocol-server** developers. Implementation lives in **seed-protocol-sdk** (`@seedprotocol/gateway-hyper`, SDK resolver, CLI). No server repo changes are required for v1, but the following optional improvements improve browser + hybrid probing.

## Recommended operator layout

1. Run the stack per [seed-protocol-server/README.md](../seed-protocol-server/README.md) Option B/C (Traefik + `arweave_gateway` + `seed_server` + bundler).
2. On the same host (or a machine with network access to Traefik):

   ```bash
   seed gateway tunnel serve --upstream http://127.0.0.1:80
   ```

   If the tunnel runs inside Docker on the compose network, use `--upstream http://traefik:80` (or the service name that fronts gateway + seed API).

3. Publish the printed **z32 operator key** to SDK consumers (`DEFAULT_SEED_GATEWAY_HYPER_KEY` or per-developer config).

## Trust and routing

- Upload API (`/api/upload/arweave/*`) and gateway reads (`/raw/{id}`, `/graphql`, `/{txId}`) should both route through the **same** Traefik upstream the tunnel proxies to.
- `ARWEAVE_GATEWAY_URL` on `seed_server` must point at the same gateway the SDK reads through, or “immediate availability” after bundler upload breaks.

## Optional server changes (not blocking v1)

| Item | Why | Suggested implementation |
|------|-----|---------------------------|
| **CORS** | Browser apps use `http://127.0.0.1:1984` via sidecar | Add `http://127.0.0.1:1984`, `http://localhost:1984` to `CORS_ALLOWED_ORIGINS` in `.env.example` |
| **Health endpoint** | Hybrid mode probes sidecar with `GET /info` (gateway) today; dedicated health is clearer | `GET /api/health` on seed_server → `{ "ok": true }` |
| **Compose service** | Co-locate tunnel with stack | Optional `gateway_tunnel` service sharing Traefik network |
| **Sandbox redirects** | ar.io wildcard subdomain redirects fail without DNS on client machines | Document: Hyper clients should prefer `/raw/{txId}` paths |
| **Bundler alignment** | Optimistic index must match read gateway | Keep gateway core + Turbo bucket/filter env aligned (existing docs) |

## Validation checklist

1. Via Traefik: `curl http://127.0.0.1/api/upload/arweave/status/{dataItemId}` (or your routed host).
2. Via Traefik: `curl http://127.0.0.1/raw/{txId}` serves a freshly uploaded item.
3. Operator: `seed gateway tunnel serve --upstream http://127.0.0.1:80`.
4. Client machine: `seed gateway tunnel connect <z32>`.
5. Client: repeat curls against `http://127.0.0.1:1984/...`.

## What SDK users configure

```typescript
export const gateway = {
  transport: 'hybrid',
  uploadApiBaseUrl: 'https://app.example.com', // HTTP fallback
  arweaveDomain: 'ar.example.com',
  gatewayHyperKey: '<operator-z32>',
}
```

They must run `seed gateway tunnel connect <key>` before the app starts when using `hyper` or when `hybrid` should prefer P2P.

## Contact

Questions about tunnel framing or SDK resolver behavior: seed-protocol-sdk maintainers (`docs/GATEWAY_HYPER.md`).
