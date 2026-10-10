# @seedprotocol/vite

[![npm](https://img.shields.io/npm/v/@seedprotocol/vite.svg)](https://www.npmjs.com/package/@seedprotocol/vite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-seedprotocol.io-0B6E4F)](https://seedprotocol.io)

Vite plugin for browser and Electron-renderer apps that use [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk). It sets up Node polyfills, ZenFS `fs` aliases, CommonJS/ESM interop fixes, dependency pre-bundling, and the cross-origin isolation headers that SQLite WASM and OPFS need. Your app can then import the SDK without its own workarounds.

## Installation

`vite` (8 or later) is a peer dependency. `vite-plugin-node-polyfills` is a dependency of this package, so you do not need to install it.

```bash
npm install -D @seedprotocol/vite
# or
bun add -d @seedprotocol/vite
# or
pnpm add -D @seedprotocol/vite
```

Your app also needs `@seedprotocol/sdk` and the ZenFS packages it uses in the browser. Pin the versions the SDK declares (currently `@zenfs/core@2.5.6` and `@zenfs/dom@1.2.9`) so only one copy is installed.

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

Initialize ZenFS in your app entry before you use the SDK (`autoInit` is off by default):

```ts
import { configure } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'

await configure({ mounts: { '/': IndexedDB } })
```

After you add or upgrade the plugin, delete `node_modules/.vite` and restart the dev server.

## What it configures

- **Node polyfills** for `path`, `buffer`, `events`, `string_decoder` and `util`. Full `stream` and `crypto` polyfills are left out because they break Vite SSR and React Router prerender. A minimal `stream` stub is aliased instead.
- **Cross-origin isolation headers** on the dev and preview servers: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, `Cross-Origin-Resource-Policy: same-origin`. They are applied on `writeHead` too, so React Router Framework Mode HTML responses get them.
- **`fs` aliases** to ZenFS (`fs`, `fs/promises`, `node:fs`, `node:fs/promises`), plus stable ESM entry points for `@zenfs/core` and `@zenfs/dom`.
- **Interop shims** for `debug` default imports and the `nanoid-dictionary` ESM build.
- **`optimizeDeps.include`** for fragile CommonJS dependencies, including the SDK's nested EAS SDK.
- **Inline `global` / `process` shims** in `index.html`. `process.env.NODE_ENV` follows the Vite `mode`, so React Refresh works under `vite serve`.

## Options

```ts
seedVitePlugin({
  includeNodePolyfills: true,
  isolationHeaders: true,
  autoInit: false,
  debug: false,
})
```

| Option | Default | Description |
|--------|---------|-------------|
| `includeNodePolyfills` | `true` | Add `vite-plugin-node-polyfills` with the defaults above. Set `false` for React Router Framework Mode or SPA prerender. |
| `isolationHeaders` | `true` | COOP/COEP/CORP on dev and preview servers. `false` disables them; `{ coop, coep, corp }` overrides individual values. |
| `fsModules` | `['fs', 'fs/promises', 'node:fs', 'node:fs/promises']` | Modules aliased to ZenFS. |
| `autoInit` | `false` | Inject a ZenFS init script into `index.html`. Browsers cannot resolve its bare `@zenfs/*` imports without an import map, so prefer initializing ZenFS in your entry. |
| `debug` | `false` | Log plugin diagnostics. |

The options type is exported as `SeedVitePluginOptions`.

## Production hosting

The headers only apply to `vite serve` and `vite preview`. In production, your host must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (or `require-corp`) on the HTML document, for example through nginx or a Netlify `_headers` file. Without them, SQLite WASM and OPFS storage do not work.

## Documentation

- Full documentation: **https://seedprotocol.io**
- [Vite renderer guide and troubleshooting](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/packages/vite/VITE_RENDERER.md)
- [Getting started](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/GETTING_STARTED.md)
- Core SDK: [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk)
- React bindings: [`@seedprotocol/react`](https://www.npmjs.com/package/@seedprotocol/react)

## License

MIT
