# @seedprotocol/gateway-hyper

[![npm](https://img.shields.io/npm/v/@seedprotocol/gateway-hyper.svg)](https://www.npmjs.com/package/@seedprotocol/gateway-hyper)

Expose a local **seed-protocol-server + ar.io gateway** stack (via Traefik or direct upstream) to SDK users over **HyperDHT**.

Two client shapes:

- **Path A — Local sidecar:** `connectTunnel` → `http://127.0.0.1:1984` (local / Electron)
- **Path B — App-server proxy:** `createGatewayProxy` → mount on `/api/seed-gateway` (hosted web browsers)

See [docs/GATEWAY_HYPER.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/GATEWAY_HYPER.md) for operator and developer runbooks. Part of [Seed Protocol](https://seedprotocol.io); the client side is configured in [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk).

## Installation

```bash
npm install @seedprotocol/gateway-hyper
```

Requires Node 20+ and Holepunch native addons. Prefer Node over Bun. Installs the `seed-gateway` CLI.

## CLI

```bash
# Operator
seed-gateway serve --upstream http://127.0.0.1:80 --key-file ./.seed/gateway-tunnel/operator.key.json

# Operator accepting only listed clients
seed-gateway serve --upstream http://127.0.0.1:80 --allow-keys <client-z32> --allow-ips 192.168.1.0/24

# Client sidecar (Path A)
seed-gateway connect <z32-key> --host 127.0.0.1 --port 1984

# Operator logging every stream and request, with a request id header upstream
seed-gateway serve --upstream http://127.0.0.1:80 --trace --request-id-header x-seed-tunnel-request-id

# Raw TCP mode, for an HTTP proxy in front (no size limit, streaming, WebSockets)
seed-gateway serve --raw --upstream http://127.0.0.1:80
seed-gateway connect --raw <raw-z32-key> --port 1985

# Client with a fixed key the operator can list
seed-gateway connect --print-key --key-file ./client.key.json
seed-gateway connect <z32-key> --key-file ./client.key.json
```

A client on the operator's LAN connects over the LAN and shows its LAN address, so list the
LAN range rather than the public IP. A connection relayed through another HyperDHT node shows
the relay's address and is refused unless its key is listed. See
[Restricting who can connect](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/GATEWAY_HYPER.md#restricting-who-can-connect).

## Library

```ts
import {
  serveTunnel,
  connectTunnel,
  createGatewayProxy,
  serveRawTunnel,
  connectRawTunnel,
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

Web SDK config for Path B (`SeedConfig.gateway` in `@seedprotocol/sdk`):

```ts
gateway: {
  transport: 'hybrid',
  proxyBaseUrl: '/api/seed-gateway',
}
```

Keep `SEED_GATEWAY_HYPER_KEY` on the server only. Authenticate / rate-limit the proxy route in production.

## Tests

- All tests run with `bun run test` (from a checkout of the monorepo). DHT tests use a local
  `hyperdht/testnet`.
- Public-DHT smoke test: `GATEWAY_HYPER_TESTS=1 bun run test`

## License

MIT
