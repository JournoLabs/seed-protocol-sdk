# @seedprotocol/vite

## Unreleased

- Fix dev server on Vite ≥ 8.2 with `includeNodePolyfills`: vite-plugin-node-polyfills' optimizer banner was registered twice, so every prebundled `.vite/deps` chunk declared `__buffer_polyfill` (and `__global_polyfill`, `__process_polyfill`) twice and failed to parse. Config hooks now return only their own additions instead of echoing existing `optimizeDeps` options back (Vite concatenates arrays), which also stops user `include`/`exclude` entries and optimizer plugins from being duplicated. The post-transform banner dedupe workaround is removed.
- The optimizer `global` define now resolves to `globalThis` with node polyfills on (it was overridden to `global`).
- `viem`, `isows`, `kerium`, `utilium`, `memium` and `readable-stream` are prebundled only when the app root can resolve them, so apps that don't depend on them directly (e.g. with a linked SDK, or without `@seedprotocol/publish`) no longer get `Failed to resolve dependency` warnings.

## 0.5.0

- Initial publish: extracted from `@seedprotocol/sdk/vite`.
