# Seed Protocol SDK

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
- **Browser** support: modern browsers with OPFS (e.g. Chromium-based, recent Firefox)

## Installation

```bash
bun add @seedprotocol/sdk
# or
npm install @seedprotocol/sdk
# or
pnpm add @seedprotocol/sdk
```

**Optional (React):** If you use React hooks (`useModel`, `useSchema`, etc.), install peer dependencies:

```bash
bun add react @tanstack/react-query
```

## Quick start

1. **Define your schema** in a config file at the project root: `seed.config.ts` (recommended), `seed.schema.ts`, or `schema.ts`.

2. **Use the SDK** in your app:

```ts
import { Model, Property, Item } from '@seedprotocol/sdk'

// Define models in your schema; then create and publish items:
const post = await Post.create({ title: 'Hello', summary: '...', ... })
await post.publish()
```

For full guides on schema, models, properties, items, files, and the CLI, see **[the docs](https://seedprotocol.io)**.

## Module support

- **ESM** (recommended): `import { Model, Property, Item } from '@seedprotocol/sdk'`
- **CommonJS**: `const { Model, Property, Item } = require('@seedprotocol/sdk')`

## License

MIT
