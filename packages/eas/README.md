# @seedprotocol/eas

[![npm](https://img.shields.io/npm/v/@seedprotocol/eas.svg)](https://www.npmjs.com/package/@seedprotocol/eas)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Read-side [Ethereum Attestation Service (EAS)](https://attest.sh) client and helpers for [Seed Protocol](https://seedprotocol.io). It queries an EAS indexer (easscan GraphQL) for Seed, Version and property attestations, resolves which chain and indexer to read from, ships known EAS deployments per chain, and decodes Seed Protocol sidecar attestations (PublishedBy, PublishAuthorization, DomainOwnership). It does not write to chain; attesting and revoking live in `@seedprotocol/publish`.

This is a lean building block. [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk) depends on it and registers the platform clients during init, so **app developers should use the SDK**. Install this package directly for servers, scripts or tools (feeds, indexers, verifiers) that read Seed attestations without the full SDK.

## Installation

```bash
npm install @seedprotocol/eas
# or
bun add @seedprotocol/eas
```

## Usage

The read helpers go through two process-wide clients (`EasClient` for GraphQL, `BaseQueryClient` for request de-duplication) that need a platform implementation. In Node.js, import the `/node` subpath, which registers both on import (`registerNodeEasPlatform()` does the same explicitly):

```ts
import '@seedprotocol/eas/node'
import {
  getSeedsBySchemaName,
  getItemVersionsFromEas,
  getCanonicalItemPropertiesFromEas,
} from '@seedprotocol/eas'

// Newest seeds for an EAS schema name, revoked ones excluded
const seeds = await getSeedsBySchemaName('post', 20)

// Versions of those seeds, then the newest live property attestation per (version, schema)
const versions = await getItemVersionsFromEas({ seedUids: seeds.map((s) => s.id) })
const properties = await getCanonicalItemPropertiesFromEas({
  versionUids: versions.map((v) => v.id),
})
```

Revoked attestations are excluded by default (`excludeRevoked: true`). See [ATTESTATION_REVOCATION.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/ATTESTATION_REVOCATION.md).

### Choosing the chain

Reads default to Optimism Sepolia (`11155420`). Without SDK or publish config, set the chain with `EAS_CHAIN_ID` (or `NEXT_PUBLIC_EAS_CHAIN_ID`); override the indexer with `EAS_ENDPOINT` / `NEXT_PUBLIC_EAS_ENDPOINT`. The SDK and `@seedprotocol/publish` set it through `configureEasReadChain`, and a conflicting chain id throws rather than reading one chain while writing another.

```ts
import { getEasReadChainId, getEasEndpoint, getEasChainDeployment } from '@seedprotocol/eas'

getEasReadChainId()           // e.g. 8453 when EAS_CHAIN_ID=8453
getEasEndpoint()              // https://base.easscan.org/graphql
getEasChainDeployment(8453)   // { name: 'Base', easContractAddress, indexerUrl, explorerUrl, ... }
```

## Exports

| Entry | Main exports |
|-------|--------------|
| `@seedprotocol/eas` | Seeds / Versions / properties: `getSeedsBySchemaName`, `getSeedsByUidsFromEas`, `getSeedsFromSchemaUids`, `getSeedUidsBySchemaName`, `getItemVersionsFromEas`, `getItemPropertiesFromEas`, `getCanonicalItemPropertiesFromEas`, `getAttestationChangesSince` |
| | Schemas: `getEasSchemaUidBySchemaName`, `fetchEasSchemaUidBySchemaName`, `getSchemaNamesBySchemaUids`, schema UID cache (`cachedSchemaLookup`, `getEasSchemaUidForSchemaDefinition`, `setSchemaUidForModel`, …) |
| | Chain config: `configureEasReadChain`, `getEasReadChainId`, `getEasEndpoint`, `whenEasReadChainSettled`, `EAS_CHAIN_DEPLOYMENTS`, `DEFAULT_EAS_CHAIN_ID`, `getEasChainDeployment`, `resolveEasChainDeployment`, `getEasAttestationExplorerUrl` |
| | Canonicalization / filters: `pickLatestPropertyAttestationsByRefAndSchema`, `withExcludeRevokedFilter`, `isValidEasAttestationUid`, `normalizeBytes32Hex` |
| | Sidecars: `getPublishedByFromEas`, `decodePublishedByData`, `verifyPublishedByBatch`; `getPublishAuthorizationFromEas`, `assessPublishAuthorization`; `getDomainOwnershipFromEas`, `assessDomainOwnership`, plus their `*_SCHEMA_NAME` / `*_SCHEMA_DEF` constants |
| | Clients: `EasClient` / `BaseEasClient`, `BaseQueryClient`, `IEasClient`, `IQueryClient`; GraphQL documents (`GET_SEEDS`, `GET_VERSIONS`, `GET_PROPERTIES`, …); types `Attestation`, `EASSchema` |
| `@seedprotocol/eas/node` | `registerNodeEasPlatform()`, `NodeEasClient`, `NodeQueryClient` (a `@tanstack/query-core` client: concurrent identical requests share one fetch) |

Sidecar details: [PUBLISHING.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/PUBLISHING.md) (PublishedBy), [PUBLISH_AUTOMATION.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/PUBLISH_AUTOMATION.md) (PublishAuthorization), [DOMAIN_OWNERSHIP.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/DOMAIN_OWNERSHIP.md).

## Related packages

- [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk) — the full local-first SDK (uses this package for EAS sync)
- [`@seedprotocol/query`](https://www.npmjs.com/package/@seedprotocol/query) — assembled Seed JSON (`getSeed`, `queryBySchema`) built on these reads
- [`@seedprotocol/arweave`](https://www.npmjs.com/package/@seedprotocol/arweave) — Arweave gateway client

## Documentation

- [seedprotocol.io](https://seedprotocol.io)
- [Changelog](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/eas/CHANGELOG.md)

## License

MIT
