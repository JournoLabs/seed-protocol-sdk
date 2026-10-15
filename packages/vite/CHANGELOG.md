# @seedprotocol/vite

## Unreleased

- Fix dev server on Vite ≥ 8.2 with `includeNodePolyfills`: vite-plugin-node-polyfills' optimizer banner was registered twice, so every prebundled `.vite/deps` chunk declared `__buffer_polyfill` (and `__global_polyfill`, `__process_polyfill`) twice and failed to parse. Config hooks now return only their own additions instead of echoing existing `optimizeDeps` options back (Vite concatenates arrays), which also stops user `include`/`exclude` entries and optimizer plugins from being duplicated. The post-transform banner dedupe workaround is removed.
- The optimizer `global` define now resolves to `globalThis` with node polyfills on (it was overridden to `global`).
- `viem`, `isows`, `kerium`, `utilium`, `memium` and `readable-stream` are prebundled only when the app root can resolve them, so apps that don't depend on them directly (e.g. with a linked SDK, or without `@seedprotocol/publish`) no longer get `Failed to resolve dependency` warnings.
- COOP/COEP/CORP values you set in `server.headers` or `preview.headers` now win over the plugin's isolation headers (they were replaced). `preview` keeps inheriting `server.headers` when you set no preview headers.
- No more "Both `rollupOptions` and `rolldownOptions` were specified" warning: the build `config()` hook returns only its own additions, so your `build.rollupOptions` / `rolldownOptions` and `commonjsOptions` pass through untouched (arrays were also being duplicated).
- The bare Node-globals build warning now reports only free references, using a parse and scope analysis. `typeof` checks, guarded uses and locally declared names (such as the process polyfill's own `var process`) no longer trigger it, so a default app builds without it. Adds a `@rollup/pluginutils` dependency.
- Docs: `autoInit` and VITE_RENDERER.md no longer tell apps to configure ZenFS (`client.init()` mounts OPFS); `fsModules` is documented as replacing the default list.

## 0.5.0

- Initial publish: extracted from `@seedprotocol/sdk/vite`.
