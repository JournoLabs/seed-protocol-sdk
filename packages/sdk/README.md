# @seedprotocol/sdk

[![npm](https://img.shields.io/npm/v/@seedprotocol/sdk.svg)](https://www.npmjs.com/package/@seedprotocol/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/node/v/@seedprotocol/sdk.svg)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/docs-seedprotocol.io-0B6E4F)](https://seedprotocol.io)

The official TypeScript SDK for [Seed Protocol](https://seedprotocol.io): a local-first, decentralized data layer.

**[→ Full documentation at seedprotocol.io](https://seedprotocol.io)**

## What it does

- **Local-first ORM.** Define schemas, models and properties; the SDK stores items in SQLite and files in OPFS in the user's browser (or on disk in Node).
- **Decentralized sync.** Data is read from and published to the [Ethereum Attestation Service (EAS)](https://attest.sh) and [Arweave](https://www.arweave.org). There is no backend for you to run.
- **No custody.** User data lives on public infrastructure and in the user's browser, not on your servers.

Built and used by [PermaPress](https://permapress.xyz), the first client for Seed Protocol (by [JournoLabs](https://journolabs.xyz)).

## Requirements

- **Node.js** `>= 20` and `<= 24`
- **Browser:** a modern browser with OPFS (e.g. Chromium-based, recent Firefox)

## Installation

```bash
npm install @seedprotocol/sdk
# or
bun add @seedprotocol/sdk
# or
pnpm add @seedprotocol/sdk
```

Browser apps built with Vite should also add [`@seedprotocol/vite`](https://www.npmjs.com/package/@seedprotocol/vite). For React hooks, add [`@seedprotocol/react`](https://www.npmjs.com/package/@seedprotocol/react).

## Quick start

Initialize the client once, then create schemas, models and items:

```ts
import { client, Schema, Model } from '@seedprotocol/sdk'

await client.init({
  config: {
    filesDir: '.seed',
    endpoints: { filePaths: '/files', files: '.seed' }, // optional on Node when filesDir is set
  },
})

const schema = await Schema.create('Blog')

const Post = await Model.create('Post', schema, {
  properties: {
    title: { dataType: 'Text' },
    content: { dataType: 'Html' },
    publishedAt: { dataType: 'Date' },
  },
})

const post = await Post.create({ title: 'Hello', content: '<p>First post</p>' })

// Update by assignment; the SDK persists the change.
post.title = 'Hello, world'
```

You can also declare your schema in a config file at the project root: `seed.config.ts` (recommended), `seed.schema.ts`, or `schema.ts`.

To publish items to EAS and Arweave, use [`@seedprotocol/publish`](https://www.npmjs.com/package/@seedprotocol/publish).

See the [Getting Started guide](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/GETTING_STARTED.md) for configuration, address sessions, property types, files and images.

## Entry points

| Import | Use |
| --- | --- |
| `@seedprotocol/sdk` | Main API: `client`, `Schema`, `Model`, `Item`, `ItemProperty`, query helpers |
| `@seedprotocol/sdk/node` | Node entry: `client`, `Item`, `FileManager`, `Db` |
| `@seedprotocol/sdk/platform` | Platform services: `configurePlatform`, `createPlatformServices` |
| `@seedprotocol/sdk/vite` | Re-export of `seedVitePlugin` from `@seedprotocol/vite`, which you install yourself (optional peer) |

ESM is recommended. CommonJS also works: `const { Schema, Model, Item } = require('@seedprotocol/sdk')`.

## Related packages

| Package | Description |
| --- | --- |
| [`@seedprotocol/react`](https://www.npmjs.com/package/@seedprotocol/react) | React hooks and components |
| [`@seedprotocol/publish`](https://www.npmjs.com/package/@seedprotocol/publish) | Publish flow (EAS attestations + Arweave uploads) |
| [`@seedprotocol/vite`](https://www.npmjs.com/package/@seedprotocol/vite) | Vite plugin for browser apps |
| [`@seedprotocol/query`](https://www.npmjs.com/package/@seedprotocol/query) | Canonical Seed JSON queries over EAS or local SQLite |
| [`@seedprotocol/feed`](https://www.npmjs.com/package/@seedprotocol/feed) | RSS, Atom and JSON Feed generation |
| [`@seedprotocol/mapping`](https://www.npmjs.com/package/@seedprotocol/mapping) | Field mapping from external sources to models |
| [`@seedprotocol/eas`](https://www.npmjs.com/package/@seedprotocol/eas) | EAS GraphQL read client |
| [`@seedprotocol/arweave`](https://www.npmjs.com/package/@seedprotocol/arweave) | Arweave gateway client |

## License

MIT
