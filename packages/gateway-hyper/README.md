# @seedprotocol/gateway-hyper

Expose a local **seed-protocol-server + ar.io gateway** stack (via Traefik or direct upstream) to SDK users over **HyperDHT**, with a localhost HTTP sidecar for apps and RSS-style tooling.

See [docs/GATEWAY_HYPER.md](../../docs/GATEWAY_HYPER.md) for operator and developer runbooks.

## Install

```bash
bun add @seedprotocol/gateway-hyper
```

Requires Node 20+ and Holepunch native addons.

## CLI

```bash
# Operator
seed gateway tunnel serve --upstream http://127.0.0.1:80 --key-file ./.seed/gateway-tunnel/operator.key.json

# Client sidecar
seed gateway tunnel connect <z32-key> --port 1984
```

## Library

```ts
import { serveTunnel, connectTunnel } from '@seedprotocol/gateway-hyper'

const operator = await serveTunnel({ upstream: 'http://127.0.0.1:80' })
console.log(operator.key)

const client = await connectTunnel({ key: operator.key, port: 1984 })
console.log(client.baseUrl) // http://127.0.0.1:1984
```

## Tests

- Unit tests always run.
- DHT integration: `GATEWAY_HYPER_TESTS=1 bun run test`
