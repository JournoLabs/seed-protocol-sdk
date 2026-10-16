# @seedprotocol/vite

## 0.7.1 (2026-10-10)

- Fix dev server on Vite ≥ 8.2 with `includeNodePolyfills`: vite-plugin-node-polyfills' optimizer banner was registered twice, so every prebundled `.vite/deps` chunk declared `__buffer_polyfill` (and `__global_polyfill`, `__process_polyfill`) twice and failed to parse. Config hooks now return only their own additions instead of echoing existing `optimizeDeps` options back (Vite concatenates arrays), which also stops user `include`/`exclude` entries and optimizer plugins from being duplicated. The post-transform banner dedupe workaround is removed.
- The optimizer `global` define now resolves to `globalThis` with node polyfills on (it was overridden to `global`).
- `viem`, `isows`, `kerium`, `utilium`, `memium` and `readable-stream` are prebundled only when the app root can resolve them, so apps that don't depend on them directly (e.g. with a linked SDK, or without `@seedprotocol/publish`) no longer get `Failed to resolve dependency` warnings.
- COOP/COEP/CORP values you set in `server.headers` or `preview.headers` now win over the plugin's isolation headers (they were replaced). `preview` keeps inheriting `server.headers` when you set no preview headers.
- No more "Both `rollupOptions` and `rolldownOptions` were specified" warning: the build `config()` hook returns only its own additions, so your `build.rollupOptions` / `rolldownOptions` and `commonjsOptions` pass through untouched (arrays were also being duplicated).
- The bare Node-globals build warning now reports only free references, using a parse and scope analysis. `typeof` checks, guarded uses and locally declared names (such as the process polyfill's own `var process`) no longer trigger it, so a default app builds without it. Adds a `@rollup/pluginutils` dependency.
- Docs: `autoInit` and VITE_RENDERER.md no longer tell apps to configure ZenFS (`client.init()` mounts OPFS); `fsModules` is documented as replacing the default list.

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
