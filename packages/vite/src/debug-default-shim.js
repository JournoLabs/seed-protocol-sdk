/**
 * ESM interop shim for the `debug` package browser entry.
 * `debug/src/browser.js` is CJS and may not expose a default export when served
 * directly by Vite; default-import consumers expect `import debug from 'debug'`.
 */
import * as debugModule from 'debug/src/browser.js'

function resolveDebugExport(mod) {
  if (typeof mod === 'function') return mod
  if (mod && typeof mod.default === 'function') return mod.default
  const candidate = mod?.default ?? mod
  if (typeof candidate === 'function') return candidate
  if (candidate && typeof candidate.default === 'function') return candidate.default
  return candidate
}

const debugFn = resolveDebugExport(debugModule)

export default debugFn
