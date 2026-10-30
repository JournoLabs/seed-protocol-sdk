# @seedprotocol/arweave

[![npm](https://img.shields.io/npm/v/@seedprotocol/arweave.svg)](https://www.npmjs.com/package/@seedprotocol/arweave)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Arweave gateway client and helpers for [Seed Protocol](https://seedprotocol.io). It provides a process-wide `ArweaveClient` facade (gateway host, `/raw` and GraphQL URLs, transaction data, tags and status), read-gateway selection with health probing and a per-host circuit breaker, Seed gateway endpoint resolution (HTTP gateway, app-server proxy, or local Hyper sidecar), and helpers for classifying media references in Seed items.

This is a lean building block. [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk) depends on it and registers the right platform client during init, so **app developers should use the SDK**. Install this package directly when you need Arweave reads in a server, script or tool (feeds, indexers, CLIs) without the full SDK.

## Installation

```bash
npm install @seedprotocol/arweave
# or
bun add @seedprotocol/arweave
```

## Usage

The root entry only holds the facade; it needs a platform implementation before it can fetch. In Node.js, import the `/node` subpath, which registers the Node client on import:

```ts
import { registerNodeArweavePlatform } from '@seedprotocol/arweave/node'
import { ArweaveClient } from '@seedprotocol/arweave'

// Optional: set the preferred read gateway (default: arweave.net)
registerNodeArweavePlatform({ arweaveDomain: 'arweave.net' })

const text = await ArweaveClient.getTransactionData(txId, { string: true })
const tags = await ArweaveClient.getTransactionTags(txId)
const { status } = await ArweaveClient.getTransactionStatus(txId) // 200 when the gateway has it

ArweaveClient.getRawUrl(txId) // https://<gateway>/raw/<txId>
```

`ArweaveClient.setHost('http://localhost:1984')` pins a gateway (plain hosts default to https) and disables read-gateway probing. Without an explicit host, the first of `NEXT_PUBLIC_ARWEAVE_HOST`, `ARWEAVE_HOST` or `VITE_ARWEAVE_HOST` is used.

### Reading across gateways

```ts
import { fetchArweaveRawTextAcrossGateways } from '@seedprotocol/arweave'

// Tries preferred gateways, then the resolved / public ones; undefined if none answer
const body = await fetchArweaveRawTextAcrossGateways(txId)
```

Override the fallback list with `ARWEAVE_READ_GATEWAYS` or `NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS` (comma-separated hosts).

### Gateway endpoint resolution

```ts
import {
  resolveSeedGatewayEndpoints,
  seedGatewayConfigFromSeedConfig,
} from '@seedprotocol/arweave'

const endpoints = await resolveSeedGatewayEndpoints(
  seedGatewayConfigFromSeedConfig({ gateway: { transport: 'hybrid' } }),
)
// endpoints.activePath: 'http' | 'http-proxy' | 'hyper-sidecar' | 'hybrid-fallback-http'
```

See [GATEWAY_HYPER.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/GATEWAY_HYPER.md) for transport modes, proxies and the Hyper sidecar.

## Exports

| Entry | Main exports |
|-------|--------------|
| `@seedprotocol/arweave` | `ArweaveClient` (alias of `BaseArweaveClient`), `IArweaveClient` |
| | Gateway constants and env helpers: `DEFAULT_ARWEAVE_HOST`, `DEFAULT_ARWEAVE_GATEWAYS`, `ARWEAVE_HOST_ENV_KEYS`, `resolveArweaveHostFromEnv`, `getArweaveReadGatewayHostsForPrimary` |
| | Read gateways: `ensureReadGatewaySelected`, `selectFirstHealthyReadGateway`, `probeGateway`, `getArweaveReadBaseUrls`, `fetchArweaveRawFromBaseUrl`, `fetchArweaveRawTextAcrossGateways`, `setPreferredArweaveReadBaseUrls` |
| | Circuit breaker: `configureGatewayCircuitBreaker`, `isGatewayHostCircuitOpen`, `recordGatewayHostSuccess` / `recordGatewayHostFailure` |
| | Gateway config: `resolveSeedGatewayEndpoints`, `resolveSidecarOrigin`, `seedGatewayConfigFromSeedConfig`, `seedGatewayConfigFromClientContext`, `SeedGatewayConfig`, `ResolvedSeedGatewayEndpoints` |
| | Upload pipeline status: `getArweaveUploadStatus`, `isArweaveL1AnchoringComplete`, `getUploadPipelineTransactionStatus`, `queryArweaveGatewayTransactionWithFallback` |
| | Media / relation refs: `classifyMediaRef`, `normalizeFeedItemFields`, `getArweaveUrlForTransaction`, `resolveSeedRssImageRelationRef`, `resolveSeedIdsFromRefString` |
| | GraphQL documents (e.g. `GET_TRANSACTION_TAGS`) and types (`TransactionStatus`, `TransactionTag`, `GetDataOptions`, `DownloadResult`) |
| `@seedprotocol/arweave/node` | `registerNodeArweavePlatform({ arweaveDomain? })`, `NodeArweaveClient` (registered as a side effect of importing this entry) |

## Related packages

- [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk) — the full local-first SDK (uses this package)
- [`@seedprotocol/eas`](https://www.npmjs.com/package/@seedprotocol/eas) — EAS GraphQL reads
- [`@seedprotocol/query`](https://www.npmjs.com/package/@seedprotocol/query) — canonical Seed JSON reads, with Arweave body hydration

## Documentation

- [seedprotocol.io](https://seedprotocol.io)
- [Changelog](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/arweave/CHANGELOG.md)

## License

MIT
