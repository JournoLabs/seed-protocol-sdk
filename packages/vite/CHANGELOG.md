# @seedprotocol/vite

## Unreleased

- **Breaking: `seedVitePlugin()` defaults cut to what the SDK needs.** By default it now sets cross-origin isolation headers, `worker.format: 'es'`, `optimizeDeps.rolldownOptions.output.strictExecutionOrder: true` (drizzle-orm's dev pre-bundle failed with `Cannot read properties of undefined (reading 'Symbol')` when the app imports `@seedprotocol/sdk/drizzle`), and, for Seed packages linked from outside the app, `resolve.dedupe` and `server.fs.allow`. [VITE_RENDERER.md](VITE_RENDERER.md) lists what each setting is for and how that was tested, plus upgrade steps.
  - `includeNodePolyfills` defaults to `false`. It now also covers the `global` / `process` defines and `index.html` shims and the `stream` stub.
  - `fsModules` defaults to `[]`: no `fs` → ZenFS aliases.
  - `autoInit` is removed.
  - The plugin no longer sets `optimizeDeps.include` / `exclude`, interop aliases (`debug`, `arweave`, `eventemitter3`, `nanoid-dictionary`, ZenFS entry files), `build.commonjsOptions` or a `better-sqlite3` external, and no longer rewrites FileManager's `path-browserify` import. Its `optimizeDeps.exclude` list broke `vite dev` under pnpm.
  - The Node-globals build warning only runs with `debug: true`.
- `resolve.dedupe` only lists packages the app root resolves, and `server.fs.allow` finds sqlocal and SQLite WASM in pnpm and bun stores.
- No longer depends on `debug`.

## 0.7.5 (2026-10-17)

### Commits

#### Fixes

- packages: top-level types for legacy resolvers; query main -> Node build (12c51228)

#### Other

- packages: add READMEs for react, vite, arweave, eas (baf86652)
- packages: add sdk README, fix root README, add homepage/bugs metadata (3d89c932)

## 0.7.4 (2026-10-15)

- COOP/COEP/CORP values you set in `server.headers` or `preview.headers` now win over the plugin's isolation headers (they were replaced). `preview` keeps inheriting `server.headers` when you set no preview headers.
- No more "Both `rollupOptions` and `rolldownOptions` were specified" warning: the build `config()` hook returns only its own additions, so your `build.rollupOptions` / `rolldownOptions` and `commonjsOptions` pass through untouched (arrays were also being duplicated).
- The bare Node-globals build warning now reports only free references, using a parse and scope analysis. `typeof` checks, guarded uses and locally declared names (such as the process polyfill's own `var process`) no longer trigger it, so a default app builds without it. Adds a `@rollup/pluginutils` dependency.
- Docs: `autoInit` and VITE_RENDERER.md no longer tell apps to configure ZenFS (`client.init()` mounts OPFS); `fsModules` is documented as replacing the default list.

### Commits

#### Fixes

- polyfill-resolve stops re-returning every alias (2b4ff514)
- config hook stops echoing the user's resolve options (336559bf)
- scan bundles for free Node-global references only (7d00c897)
- build config() returns only its additions (ecb797ed)
- user COOP/COEP/CORP headers win over the plugin's (172286ce)
- query: throw when clients are registered on another copy of eas/arweave (aec6c2e7)

#### Other

- autoInit and fsModules describe what the plugin does (824e2564)

## 0.7.1 (2026-10-10)

- Fix dev server on Vite ≥ 8.2 with `includeNodePolyfills`: vite-plugin-node-polyfills' optimizer banner was registered twice, so every prebundled `.vite/deps` chunk declared `__buffer_polyfill` (and `__global_polyfill`, `__process_polyfill`) twice and failed to parse. Config hooks now return only their own additions instead of echoing existing `optimizeDeps` options back (Vite concatenates arrays), which also stops user `include`/`exclude` entries and optimizer plugins from being duplicated. The post-transform banner dedupe workaround is removed.
- The optimizer `global` define now resolves to `globalThis` with node polyfills on (it was overridden to `global`).
- `viem`, `isows`, `kerium`, `utilium`, `memium` and `readable-stream` are prebundled only when the app root can resolve them, so apps that don't depend on them directly (e.g. with a linked SDK, or without `@seedprotocol/publish`) no longer get `Failed to resolve dependency` warnings.

### Commits

#### Fixes

- gate zenfs helper includes on app-root resolution (55531e55)
- register the node-polyfills optimizer banner once (25496b00)

## 0.6.10 (2026-10-04)

### Commits

#### Other

- Fixing gas estimation. v0.6.10 (d5b161a1)

## 0.6.7 (2026-10-01)

_Also covers 0.6.4, 0.6.5, 0.6.6, published from commits in this range._

### Commits

#### Other

- Final edits (687d320b)
- Fixing Vite plugin bugs (59fad217)
- Keep Node builtins and CJS keccak off the Seed browser graph. (3bc60ae1)
- Stop treating a failed client init as ready. (b32df5e7)

## 0.5.1 (2026-08-29)

### Commits

#### Features

- extract @seedprotocol/vite bundler plugin package (60c87aed)

#### Other

- replace setPlatformClass with instance + static facade (0bca44b7)

## 0.5.0

- Initial publish: extracted from `@seedprotocol/sdk/vite`.
