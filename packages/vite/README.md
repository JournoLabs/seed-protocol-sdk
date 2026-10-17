# @seedprotocol/vite

[![npm](https://img.shields.io/npm/v/@seedprotocol/vite.svg)](https://www.npmjs.com/package/@seedprotocol/vite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-seedprotocol.io-0B6E4F)](https://seedprotocol.io)

Vite plugin for browser apps that use [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk). It sends the cross-origin isolation headers SQLite WASM and OPFS need on the dev and preview servers, builds workers as ES modules, and makes Seed packages linked from outside the app (`file:`, `link:`, a workspace) work under `vite dev`.

## Installation

`vite` (8 or later) is a peer dependency.

```bash
npm install -D @seedprotocol/vite
```

## Usage

`seedVitePlugin()` returns an **array** of plugins, so spread it into `plugins`:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seedVitePlugin } from '@seedprotocol/vite'

export default defineConfig({
  plugins: [react(), ...seedVitePlugin()],
})
```

Don't list `@seedprotocol/*` packages, `sqlocal`, `drizzle-orm` or `@sqlite.org/sqlite-wasm` in `optimizeDeps.exclude`. Vite pre-bundles them, and under pnpm an excluded `sqlocal` can't be resolved from the pre-bundled SDK.

## What it configures

- **Cross-origin isolation headers** on the dev and preview servers: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, `Cross-Origin-Resource-Policy: same-origin`. They are also set in `writeHead`, so React Router Framework Mode HTML responses get them. Without them the page isn't cross-origin isolated and the SDK can't keep its database in OPFS.
- **`worker.format: 'es'`**, unless you set a format. SQLite's worker code-splits, which Vite's default `'iife'` worker format can't do, so the database never opens in a production build.
- **`optimizeDeps.rolldownOptions.output.strictExecutionOrder: true`**, unless you set it. drizzle-orm's modules import each other in a cycle; when your app imports both `@seedprotocol/sdk` and `@seedprotocol/sdk/drizzle`, the dev pre-bundle can otherwise run them out of order and fail with `Cannot read properties of undefined (reading 'Symbol')`.
- **`resolve.dedupe`** for React, thirdweb, xstate, ZenFS and the Seed packages, each only when your app root resolves it. A linked Seed package otherwise loads its own React (hooks fail) or its own copy of a Seed package.
- **`server.fs.allow`** for the SDK, sqlocal and SQLite WASM directories when they are outside your app, so `vite dev` can serve the database worker and WASM file of a linked SDK.

With an SDK installed from npm in the app itself, only the first three matter, and you can set them without the plugin:

```ts
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  optimizeDeps: { rolldownOptions: { output: { strictExecutionOrder: true } } },
})
```

[VITE_RENDERER.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/vite/VITE_RENDERER.md) lists what each setting is needed for, how that was tested, and what the plugin no longer does.

## Options

```ts
seedVitePlugin({
  isolationHeaders: true,
  includeNodePolyfills: false,
  fsModules: [],
  debug: false,
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `isolationHeaders` | `true` | COOP/COEP/CORP on the dev and preview servers. `false` disables them; `{ coop, coep, corp }` overrides individual values. A value you set in `server.headers` or `preview.headers` wins for that server. |
| `includeNodePolyfills` | `false` | Add `vite-plugin-node-polyfills` for `path`, `buffer`, `events`, `string_decoder` and `util` and the `Buffer` / `process` / `global` globals, a minimal `stream` stub, and inline `global` / `process` shims in `index.html`. The SDK doesn't need them; turn this on when another dependency uses Node built-ins in the browser. Full `stream` and `crypto` polyfills are left out because they break Vite SSR and React Router prerender. |
| `fsModules` | `[]` | Modules aliased to ZenFS (`@zenfs/core`, or `@zenfs/core/promises` for ids containing "promises"), for app code or other dependencies that import `fs` in the browser. The SDK doesn't. For example `['fs', 'fs/promises', 'node:fs', 'node:fs/promises']`. |
| `debug` | `false` | Log what the plugin adds, and warn about Node-only globals (`process`, `Buffer`, `global`, `__dirname`, `__filename`) left in production chunks. |

The options type is exported as `SeedVitePluginOptions`.

## Production hosting

The headers only apply to `vite dev` and `vite preview`. In production, your host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`) on the HTML document, for example through nginx or a Netlify `_headers` file.

## Documentation

- Full documentation: **https://seedprotocol.io**
- [What each setting is for, and upgrading from 0.7](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/vite/VITE_RENDERER.md)
- Core SDK: [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk)
- React bindings: [`@seedprotocol/react`](https://www.npmjs.com/package/@seedprotocol/react)

## License

MIT
