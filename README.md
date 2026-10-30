# Seed Protocol SDK

[![npm](https://img.shields.io/npm/v/@seedprotocol/sdk.svg)](https://www.npmjs.com/package/@seedprotocol/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@seedprotocol/sdk.svg)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/docs-seedprotocol.io-0B6E4F)](https://seedprotocol.io)

The official JavaScript/TypeScript SDK for [Seed Protocol](https://seedprotocol.io)—a local-first, decentralized data layer.

**[→ Full documentation at seedprotocol.io](https://seedprotocol.io)**

---

## What it does

- **Local-first ORM** — Define models and properties; the SDK stores data in SQLite and OPFS in the user’s browser.
- **Decentralized sync** — Data is read from and written to the [Ethereum Attestation Service (EAS)](https://attest.sh) and [Arweave](https://www.arweave.org). No backend for you to run or maintain.
- **No custody** — User data stays on public infrastructure and in the user’s browser, not on your servers.

Built and used by [PermaPress](https://permapress.xyz), the first client for Seed Protocol (by [JournoLabs](https://journolabs.xyz)).

## Documentation

For setup, schema definition, models, items, files, and React integration, see:

**https://seedprotocol.io**

## Requirements

- **Node.js** `>= 20` and `<= 24`
- **Browser:** Chrome or Edge 102, Firefox 114, Safari 26 or later ([supported browsers](docs/GETTING_STARTED.md#supported-browsers))

## Installation

```bash
bun add @seedprotocol/sdk
# or
npm install @seedprotocol/sdk
# or
pnpm add @seedprotocol/sdk
```

**Optional (React):** For React hooks (`useModel`, `useItems`, etc.), install [`@seedprotocol/react`](https://www.npmjs.com/package/@seedprotocol/react) and its peer dependencies:

```bash
bun add @seedprotocol/react react @tanstack/react-query
```

## Quick start

1. **Optionally declare your schema** in a config file at the project root: `seed.config.ts` (recommended), `seed.schema.ts`, or `schema.ts`.

2. **Use the SDK** in your app:

```ts
import { client, Schema, Model } from '@seedprotocol/sdk'

await client.init({ config: { filesDir: '.seed' } })

const schema = await Schema.create('Blog')
const Post = await Model.create('Post', schema, {
  properties: { title: { dataType: 'Text' }, summary: { dataType: 'Text' } },
})
const post = await Post.create({ title: 'Hello', summary: '...' })
post.title = 'Hello, world' // persisted by the SDK
```

`item.publish()` needs **[@seedprotocol/publish](packages/publish)**. The SDK builds the payload, but the uploads and EAS writes are done by an executor that the publish package registers when you call its `initPublish()` (or mount `<PublishProvider config>`). Without it, `publish()` throws an error saying so. `item.unpublish()` works the same way.

For full guides on schema, models, properties, items, files, and the CLI, see **[the docs](https://seedprotocol.io)** and [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## Module support

- **ESM** (recommended): `import { Schema, Model, Item } from '@seedprotocol/sdk'`
- **CommonJS**: `const { Schema, Model, Item } = require('@seedprotocol/sdk')`. The package is ESM-only; `require()` loads the same ESM build through Node's `require(esm)`, so it needs Node 20.19+ or 22.12+.

## Packages

| Package | Description |
| --- | --- |
| [`@seedprotocol/sdk`](packages/sdk) | Core SDK: local-first ORM, EAS + Arweave sync |
| [`@seedprotocol/react`](packages/react) | React hooks and components |
| [`@seedprotocol/publish`](packages/publish) | Publish flow (EAS attestations + Arweave uploads) |
| [`@seedprotocol/vite`](packages/vite) | Vite plugin for browser apps |
| [`@seedprotocol/query`](packages/query) | Canonical Seed JSON queries over EAS or local SQLite |
| [`@seedprotocol/feed`](packages/feed) | RSS, Atom and JSON Feed generation |
| [`@seedprotocol/feed-hyper`](packages/feed-hyper) | Hyperdrive / Hyperswarm feed distribution |
| [`@seedprotocol/gateway-hyper`](packages/gateway-hyper) | Hyperswarm HTTP tunnel for gateway + upload API |
| [`@seedprotocol/mapping`](packages/mapping) | Field mapping from external sources to models |
| [`@seedprotocol/eas`](packages/eas) | EAS GraphQL read client |
| [`@seedprotocol/arweave`](packages/arweave) | Arweave gateway client |

## License

MIT
