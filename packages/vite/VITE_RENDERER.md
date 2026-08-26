# Vite renderer integration (`@seedprotocol/vite`)

Use `seedVitePlugin()` in Vite/Electron renderer configs so browser apps can import `@seedprotocol/sdk` without per-app CJS/ESM workarounds.

`@seedprotocol/sdk/vite` re-exports this package for backward compatibility.

## Quick start

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seedVitePlugin } from '@seedprotocol/vite'

export default defineConfig({
  plugins: [react(), ...seedVitePlugin()],
})
```

Recommended: **Vite 8** and **@vitejs/plugin-react 6** (aligned with this monorepo).

## What the plugin configures automatically

- **Node polyfills** (`vite-plugin-node-polyfills`) with browser-safe defaults (optional via `includeNodePolyfills: false`). The SDK depends on that package and rewrites its injected shim imports (`…/shims/buffer`, `…/shims/global`, `…/shims/process`) plus `buffer` / `process` / `global` (and `node:` variants) to absolute paths from the SDK install. Those aliases are applied to both normal `resolve.alias` and Vite 8’s Rolldown `optimizeDeps` graph, so apps do **not** need to install `vite-plugin-node-polyfills` themselves (even when it is nested under `@seedprotocol/sdk`).
- **FS aliases** (`fs` → `@zenfs/core`, etc.) and **ZenFS stable ESM entrypoints** (`@zenfs/core`, `@zenfs/core/path`, `@zenfs/dom`).
- **`nanoid-dictionary`** → `dist/dictionary.esm.js` (avoids broken UMD `browser` field with namespace imports).
- **`debug` interop shim** so `import debug from 'debug'` works in the renderer.
- **`optimizeDeps.include`** for fragile deps: `debug`, `random`, `seedrandom`, `@georgedoescode/generative-utils`, `nanoid-dictionary`, plus ZenFS/stream/viem helpers when installed.
- **SDK dist CommonJS** handling and **FileManager** import-shape fix (`path-browserify` default → `import * as path from 'path'`).
- **Inline `global` / `process` shims** in `index.html` for early CJS wrapper evaluation.

Initialize ZenFS in your app entry (default `autoInit: false`):

```ts
import { configure } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'

await configure({ mounts: { '/': IndexedDB } })
```

## Migrating from app-local fixes

If you previously added aliases/plugins like permapress’s `createRendererResolveAliases`, `rendererOptimizeDepsInclude`, or `permapress-sdk-import-fix`, you can remove them after upgrading to an SDK release that includes this hardening—**as long as** you use `...seedVitePlugin()` in the renderer config.

After upgrading:

1. Bump `@seedprotocol/sdk` to the release with renderer hardening.
2. Align **Vite 8** and **@vitejs/plugin-react 6** with your app. You do **not** need a direct `vite-plugin-node-polyfills` dependency unless you set `includeNodePolyfills: false` and wire the plugin yourself. The SDK depends on **vite-plugin-node-polyfills ≥ 0.27** (inject-based; avoids Vite 8 double-banner errors from 0.25).
3. Clear Vite cache: delete `node_modules/.vite` (and Electron renderer cache dirs if applicable).
4. Restart dev server.
5. Ensure plugins are spread: `plugins: [react(), ...seedVitePlugin()]` (the helper returns an array).

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `includeNodePolyfills` | `true` | Add `vite-plugin-node-polyfills` (SDK dependency) with defaults and absolute shim aliases |
| `autoInit` | `false` | Inject ZenFS init script into `index.html` (usually prefer manual init) |
| `fsModules` | `fs`, `fs/promises`, `node:fs`, … | Extra modules aliased to ZenFS |
| `debug` | `false` | Plugin diagnostic logging (not the `debug` npm package) |

## Troubleshooting

- **`Failed to resolve import "vite-plugin-node-polyfills/shims/…"`** or **optimizer `Could not load vite-plugin-node-polyfills/shims/buffer`** (often via `readable-stream` → `buffer`): use an SDK build that absolute-aliases those shims (including for `optimizeDeps`), spread `...seedVitePlugin()`, and clear `node_modules/.vite`. You should not need to add `vite-plugin-node-polyfills` to the app unless you disabled `includeNodePolyfills`.
- **`Identifier '__buffer_polyfill' has already been declared`**: Vite 8 can apply the polyfills globals banner twice (especially on optimized deps). Use a current SDK build (dedupes the banner on serve), polyfills **≥ 0.27**, delete `node_modules/.vite`, and restart.
- **`does not provide an export named 'default'`** for `…/shims/process/dist/index.cjs?import` (or buffer/global): the SDK must alias shims to the ESM `index.js` build, not the CJS `index.cjs` from `require.resolve`. Upgrade/rebuild the SDK and clear `.vite`.
- **`does not provide an export named 'default'`** for `debug` or similar: ensure `...seedVitePlugin()` is in `plugins`, clear `.vite` cache, and confirm the SDK version includes the debug shim.
- **ZenFS / dictionary errors**: confirm `@zenfs/core`, `@zenfs/dom`, and `nanoid-dictionary` are installed (SDK optional deps / your app dependencies).
- **Still need a one-off alias**: open an issue; prefer fixing defaults in `@seedprotocol/sdk/vite` over per-app patches.
