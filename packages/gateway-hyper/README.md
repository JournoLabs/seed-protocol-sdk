# @seedprotocol/gateway-hyper

Expose a local **seed-protocol-server + ar.io gateway** stack (via Traefik or direct upstream) to SDK users over **HyperDHT**.

Two client shapes:

- **Path A — Local sidecar:** `connectTunnel` → `http://127.0.0.1:1984` (local / Electron)
- **Path B — App-server proxy:** `createGatewayProxy` → mount on `/api/seed-gateway` (hosted web browsers)

See [docs/GATEWAY_HYPER.md](../../docs/GATEWAY_HYPER.md) for operator and developer runbooks.

## Install

```bash
bun add @seedprotocol/gateway-hyper
```

Requires Node 20+ and Holepunch native addons. Prefer Node over Bun.

## CLI

```bash
# Operator
seed gateway tunnel serve --upstream http://127.0.0.1:80 --key-file ./.seed/gateway-tunnel/operator.key.json

# Client sidecar (Path A)
seed gateway tunnel connect <z32-key> --port 1984
```

## Library

```ts
import {
  serveTunnel,
  connectTunnel,
  createGatewayProxy,
} from '@seedprotocol/gateway-hyper'

const operator = await serveTunnel({ upstream: 'http://127.0.0.1:80' })
console.log(operator.key)

// Path A
const client = await connectTunnel({ key: operator.key, port: 1984 })
console.log(client.baseUrl) // http://127.0.0.1:1984

// Path B — Next.js App Router (Node runtime)
const proxy = createGatewayProxy({
  key: process.env.SEED_GATEWAY_HYPER_KEY ?? operator.key,
  mountPath: '/api/seed-gateway',
})
export const GET = (req: Request) => proxy.handleFetch(req)
export const POST = (req: Request) => proxy.handleFetch(req)
```

Web SDK config for Path B:

```ts
gateway: {
  transport: 'hybrid',
  proxyBaseUrl: '/api/seed-gateway',
}
```

Keep `SEED_GATEWAY_HYPER_KEY` on the server only. Authenticate / rate-limit the proxy route in production.

## Tests

- Unit tests always run.
- DHT integration: `GATEWAY_HYPER_TESTS=1 bun run test`
