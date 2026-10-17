# What `seedVitePlugin()` sets, and why

`@seedprotocol/sdk/vite` re-exports this package's `seedVitePlugin` for backward compatibility. `@seedprotocol/vite` is an optional peer of the SDK, so install it in your app to use either import.

## Settings and what needs them

These were checked with a Vite 8.3 + React 19 app installed with npm, pnpm and bun, and once more with the Seed packages linked (`file:`) from a checkout, each under `vite dev` and `vite build` + `vite preview` in Chromium. The app initializes the SDK, creates an item with Text, Html, Image and File values, reads it back through `useItems`, `Item.find` and a drizzle query, publishes it (Arweave data items to a local upload stub, attestations to a local EAS chain), downloads the uploaded files into OPFS, and syncs the item from EAS into a fresh browser profile.

| Setting | Needed for | Now |
|---------|------------|-----|
| COOP / COEP headers (also in `writeHead`) | Keeping the database in OPFS. Without them the page isn't cross-origin isolated: the SDK falls back to an in-memory database, or fails with `DB_NOT_PERSISTENT` where that check exists. | default |
| `worker.format: 'es'` | Production builds. With Vite's `'iife'` default, init fails with `Failed query` because SQLite's worker can't load. | default, unless you set a format |
| `resolve.dedupe` | Linked installs. Without it a linked `@seedprotocol/react` loads its own React and hooks fail (`Invalid hook call`). Only packages the app root resolves are listed; Vite resolves deduplicated packages from the root. | default |
| `server.fs.allow` for the SDK, sqlocal and SQLite WASM | Linked installs under `vite dev`: the sqlocal worker and the WASM file are outside the app, so Vite refuses to serve them. | default, dev server only |
| Node polyfills, `global` / `process` defines and HTML shims, `stream` stub | Nothing the SDK, `@seedprotocol/react` or `@seedprotocol/publish` does. Publish's batch upload used the `Buffer` global in 0.7.5 and earlier. `@seedprotocol/feed` and `@seedprotocol/mapping` in the browser were not tested. | `includeNodePolyfills: true` |
| `fs` → ZenFS aliases | Nothing in the SDK. In 0.7.5 and earlier its browser entry kept a bare `import 'fs'`, which Vite stubbed and webpack failed on. | `fsModules` |
| Warnings about Node globals in production chunks | Diagnostics. | `debug: true` |
| `optimizeDeps.exclude` of the SDK, drizzle-orm, sqlocal, better-sqlite3 | Nothing. It broke pnpm: an excluded package imported from a pre-bundled one has to resolve from the app root, which pnpm doesn't hoist to (`sqlocal/drizzle`, or `pluralize` with the SDK excluded). | removed |
| `optimizeDeps.include` lists (nested EAS SDK, `pluralize`, ZenFS, `debug`, Seed shared-state packages, viem and others) | Only needed because the SDK was excluded from pre-bundling, so Vite served its CommonJS dependencies raw. | removed |
| Interop aliases for `debug`, `arweave`, `eventemitter3`, `nanoid-dictionary` and the ZenFS entry files | Same: CommonJS/UMD interop for an SDK served unbundled. | removed |
| `build.commonjsOptions`, `better-sqlite3` as a build external | Nothing. The SDK's browser build doesn't reference better-sqlite3 since its Node platform moved behind `#seed-node-platform`. | removed |
| FileManager `path-browserify` import rewrite | Nothing. That import is only in the SDK's Node entry. | removed |
| `autoInit` (ZenFS IndexedDB mount script) | Nothing. `client.init()` mounts OPFS itself, and the script's bare imports need an import map. | removed |

Not covered by these checks: Electron renderers, React Router Framework Mode and SSR, Yarn, and a real Arweave gateway.

`vite build` prints that it externalized `fs`-like Node modules for a few dependencies: `node:dns` (`@seedprotocol/publish`, only for domain ownership checks), `net` (rdapper, same) and `crypto` (thirdweb's x402 signing). None of these run in the paths above.

## Upgrading from 0.7

1. Delete `node_modules/.vite` and restart the dev server.
2. If a dependency of your app needs Node built-ins or the `Buffer` / `process` globals in the browser (you'll see `ReferenceError: Buffer is not defined` or Vite's "has been externalized for browser compatibility" error at runtime), set `includeNodePolyfills: true`. Run `vite build` with `debug: true` to list Node globals left in your chunks.
3. If your code imports `fs` in the browser, set `fsModules: ['fs', 'fs/promises', 'node:fs', 'node:fs/promises']`.
4. Remove `autoInit` from your options.
5. Remove workarounds copied from older plugin versions or app configs: `optimizeDeps.exclude` entries for Seed packages, sqlocal, drizzle-orm or SQLite WASM; `optimizeDeps.include` entries for the SDK's dependencies; aliases for `nanoid-dictionary`, `debug` or the ZenFS entry files; FileManager import rewrites.

## Troubleshooting

- **`Failed to resolve import "sqlocal/drizzle"`** or **`does not provide an export named 'default'`** under pnpm: something lists the SDK, sqlocal or drizzle-orm in `optimizeDeps.exclude`. Remove those entries.
- **`sqlocal worker failed to start`** or **`expected magic word 00 61 73 6d`** under `vite dev` with a linked SDK: the worker or WASM file is outside `server.fs.allow`. Use `seedVitePlugin()`, or add the SDK, sqlocal and `@sqlite.org/sqlite-wasm` directories to `server.fs.allow`.
- **`Invalid hook call`** with a linked `@seedprotocol/react`: two Reacts. Use `seedVitePlugin()`, or add `react` and `react-dom` to `resolve.dedupe`.
- **`DuplicateEasModuleError`** or **`DuplicateArweaveModuleError`**: two copies of a Seed package. Check `npm ls @seedprotocol/eas`, keep Seed packages out of `optimizeDeps.exclude`, and dedupe them when they are linked.
- **`Failed query`** at init in a production build only: workers built as `'iife'`. Set `worker.format: 'es'`.
