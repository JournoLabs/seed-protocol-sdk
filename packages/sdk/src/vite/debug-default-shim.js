/**
 * ESM interop shim for the `debug` package browser entry.
 * `debug/src/browser.js` is CJS and may not expose a default export when served
 * directly by Vite; default-import consumers expect `import debug from 'debug'`.
 */
import * as debugModule from 'debug/src/browser.js'

// #region agent log
fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30ce80'},body:JSON.stringify({sessionId:'30ce80',runId:'pre-fix',hypothesisId:'A',location:'debug-default-shim.js:8',message:'debug shim module load',data:{moduleType:typeof debugModule,defaultType:typeof debugModule?.default,keys:Object.keys(debugModule||{}).slice(0,8)},timestamp:Date.now()})}).catch(()=>{});
// #endregion

function resolveDebugExport(mod) {
  if (typeof mod === 'function') return mod
  if (mod && typeof mod.default === 'function') return mod.default
  const candidate = mod?.default ?? mod
  if (typeof candidate === 'function') return candidate
  if (candidate && typeof candidate.default === 'function') return candidate.default
  return candidate
}

const debugFn = resolveDebugExport(debugModule)

// #region agent log
fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30ce80'},body:JSON.stringify({sessionId:'30ce80',runId:'pre-fix',hypothesisId:'A',location:'debug-default-shim.js:22',message:'debug shim resolved export',data:{debugFnType:typeof debugFn,isSameModule:debugFn===debugModule},timestamp:Date.now()})}).catch(()=>{});
// #endregion

export default debugFn
