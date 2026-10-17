import type { Plugin, UserConfig } from 'vite'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { appendAliases, normalizeAliasEntries, type AliasEntry } from './aliases'

// `includeNodePolyfills: true`. The SDK doesn't need any of this; it is for apps whose other
// dependencies use Node built-ins or the `Buffer` / `process` / `global` globals.

const _req = createRequire(import.meta.url)
const STREAM_SHIM_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stream-default-shim.js')

/** Bare IDs that vite-plugin-node-polyfills injects into every transformed module. */
const NODE_POLYFILL_SHIM_IDS = [
  'vite-plugin-node-polyfills/shims/buffer',
  'vite-plugin-node-polyfills/shims/global',
  'vite-plugin-node-polyfills/shims/process',
] as const

type NodePolyfillShimPaths = {
  buffer?: string
  global?: string
  process?: string
}

/**
 * Prefer the package "import" ESM build (index.js). createRequire resolves the
 * "require" condition (index.cjs); Vite then serves `/@fs/...cjs?import` and
 * default-import fails in the browser.
 */
function resolvePolyfillShimFile(shimId: string): string {
  const resolved = _req.resolve(shimId)
  if (resolved.endsWith('.cjs')) {
    const esm = resolved.slice(0, -4) + '.js'
    if (fs.existsSync(esm)) return esm
  }
  return resolved
}

function resolveNodePolyfillShimPaths(): {
  paths: NodePolyfillShimPaths
  unresolved: string[]
} {
  const paths: NodePolyfillShimPaths = {}
  const unresolved: string[] = []
  for (const id of NODE_POLYFILL_SHIM_IDS) {
    try {
      const abs = resolvePolyfillShimFile(id)
      if (id.endsWith('/buffer')) paths.buffer = abs
      else if (id.endsWith('/global')) paths.global = abs
      else if (id.endsWith('/process')) paths.process = abs
    } catch {
      unresolved.push(id)
    }
  }
  return { paths, unresolved }
}

/** Rewrite leftover bare shim package ids to absolute ESM files (post import-analysis). */
function rewriteBarePolyfillShimImports(
  code: string,
  paths: NodePolyfillShimPaths,
): string | null {
  let next = code
  let changed = false
  const replacements: Array<[string, string]> = []
  if (paths.buffer) {
    replacements.push(['vite-plugin-node-polyfills/shims/buffer', paths.buffer])
  }
  if (paths.global) {
    replacements.push(['vite-plugin-node-polyfills/shims/global', paths.global])
  }
  if (paths.process) {
    replacements.push(['vite-plugin-node-polyfills/shims/process', paths.process])
  }
  for (const [bare, abs] of replacements) {
    const absLiteral = JSON.stringify(abs)
    for (const quote of ['"', "'"] as const) {
      const from = `${quote}${bare}${quote}`
      if (!next.includes(from)) continue
      next = next.split(from).join(absLiteral)
      changed = true
    }
  }
  return changed ? next : null
}

/**
 * Alias polyfill shim bare imports + buffer/process/global module ids to absolute
 * paths resolved from this package. Nested installs under @seedprotocol/sdk are
 * invisible to consumer-project resolution (and to Vite 8's Rolldown optimizer)
 * unless we rewrite to absolute files.
 */
function addNodePolyfillShimAliases(
  aliasEntries: AliasEntry[],
  paths: NodePolyfillShimPaths,
): void {
  if (paths.buffer) {
    aliasEntries.push(
      { find: 'vite-plugin-node-polyfills/shims/buffer', replacement: paths.buffer },
      { find: /^buffer$/, replacement: paths.buffer },
      { find: /^node:buffer$/, replacement: paths.buffer },
    )
  }
  if (paths.global) {
    aliasEntries.push(
      { find: 'vite-plugin-node-polyfills/shims/global', replacement: paths.global },
      { find: /^global$/, replacement: paths.global },
    )
  }
  if (paths.process) {
    aliasEntries.push(
      { find: 'vite-plugin-node-polyfills/shims/process', replacement: paths.process },
      { find: /^process$/, replacement: paths.process },
      { find: /^node:process$/, replacement: paths.process },
    )
  }
}

/** Object-form aliases for optimizeDeps.rolldown/rollup resolve (string keys). */
function nodePolyfillShimAliasObject(paths: NodePolyfillShimPaths): Record<string, string> {
  const alias: Record<string, string> = {}
  if (paths.buffer) {
    alias['vite-plugin-node-polyfills/shims/buffer'] = paths.buffer
    alias.buffer = paths.buffer
    alias['node:buffer'] = paths.buffer
  }
  if (paths.global) {
    alias['vite-plugin-node-polyfills/shims/global'] = paths.global
    alias.global = paths.global
  }
  if (paths.process) {
    alias['vite-plugin-node-polyfills/shims/process'] = paths.process
    alias.process = paths.process
    alias['node:process'] = paths.process
  }
  return alias
}

const POLYFILL_ALIAS_FINDS_TO_REPLACE = new Set([
  'vite-plugin-node-polyfills/shims/buffer',
  'vite-plugin-node-polyfills/shims/global',
  'vite-plugin-node-polyfills/shims/process',
  'buffer',
  'node:buffer',
  'process',
  'node:process',
  'global',
])

/**
 * Put absolute polyfill aliases first and drop bare/package-id entries that
 * vite-plugin-node-polyfills may have added for the same modules (first match wins).
 */
function withPreferredPolyfillAliases(
  existing: AliasEntry[],
  paths: NodePolyfillShimPaths,
): AliasEntry[] {
  const preferred: AliasEntry[] = []
  addNodePolyfillShimAliases(preferred, paths)
  if (preferred.length === 0) return existing

  const filtered = existing.filter((entry) => {
    if (typeof entry.find !== 'string') return true
    return !POLYFILL_ALIAS_FINDS_TO_REPLACE.has(entry.find)
  })
  return [...preferred, ...filtered]
}

type OptimizeDepsConfig = NonNullable<UserConfig['optimizeDeps']>

/**
 * A Vite 8 `optimizeDeps.rolldownOptions` patch for a plugin `config()` hook.
 *
 * Returns only what this plugin adds. Vite deep-merges hook results into the
 * user config and concatenates arrays, so echoing existing options back would
 * duplicate them — e.g. vite-plugin-node-polyfills' optimizer banner plugin,
 * which then declares `__buffer_polyfill` twice in every prebundled chunk.
 * Legacy `esbuildOptions.define` is carried into `transform.define` so
 * definitions survive the move off the deprecated key.
 */
export function optimizeDepsRolldownPatch(
  existing: OptimizeDepsConfig | undefined,
  patch: {
    define?: Record<string, string>
    alias?: Record<string, string>
  },
): OptimizeDepsConfig['rolldownOptions'] {
  const define = {
    ...existing?.esbuildOptions?.define,
    ...patch.define,
  }
  const alias = patch.alias ?? {}

  return {
    ...(Object.keys(define).length > 0 ? { transform: { define } } : {}),
    ...(Object.keys(alias).length > 0 ? { resolve: { alias } } : {}),
  }
}

/**
 * vite-plugin-node-polyfills (path, buffer, events, string_decoder, util and the Buffer /
 * process / global globals), with its shim imports resolved from this package so apps don't
 * install it, a minimal `stream` stub, and inline `global` / `process` shims in index.html.
 */
export function nodePolyfillPlugins(log: (...args: unknown[]) => void): Plugin[] {
  const { paths: shimPaths, unresolved } = resolveNodePolyfillShimPaths()
  const shimAliasObj = nodePolyfillShimAliasObject(shimPaths)
  if (unresolved.length > 0) {
    console.warn(
      '[seed-vite-plugin] Could not resolve vite-plugin-node-polyfills shims:\n' +
        unresolved.map((id) => `  - ${id}`).join('\n') +
        '\nNode polyfill globals may fail to resolve. Reinstall @seedprotocol/vite.',
    )
  } else {
    log('Resolved vite-plugin-node-polyfills shims to absolute paths')
  }

  // Minimal stream stub (not stream-browserify, which breaks Vite SSR / React Router prerender)
  // so sax / rss-parser init is quiet.
  const streamAliases: Record<string, string> = fs.existsSync(STREAM_SHIM_FILE)
    ? { stream: STREAM_SHIM_FILE, 'node:stream': STREAM_SHIM_FILE }
    : {}
  let htmlNodeEnv = 'production'

  const globalsPlugin: Plugin = {
    name: 'seed-protocol:node-globals',
    enforce: 'pre',

    config(userConfig, env) {
      if (env?.mode) htmlNodeEnv = env.mode
      appendAliases(
        userConfig,
        Object.entries(streamAliases).map(([find, replacement]): AliasEntry => ({
          find: new RegExp(`^${find}$`),
          replacement,
        })),
      )
      const userDefine = userConfig.define ?? {}
      // Not process.env.NODE_ENV: Vite sets it from the mode, and forcing "production" during
      // `vite serve` compiles out React Refresh.
      const define = Object.fromEntries(
        Object.entries({
          global: 'globalThis',
          'process.browser': 'true',
          'process.platform': '"browser"',
        }).filter(([key]) => !(key in userDefine)),
      )
      return {
        define,
        optimizeDeps: {
          // Keep the `global` shim in the optimizer's Rolldown options too; top-level `define`
          // only covers app code and build chunks.
          rolldownOptions: optimizeDepsRolldownPatch(userConfig.optimizeDeps, {
            define: { global: 'globalThis' },
            alias: { ...streamAliases, ...shimAliasObj },
          }),
        },
      }
    },

    transformIndexHtml(html) {
      // A classic script runs before any module, so `global` and `process` exist when CJS
      // wrappers evaluate; the polyfills plugin injects module imports, which load too late.
      const shimScript = `<script>
(function(){
  if(typeof globalThis.global==='undefined')globalThis.global=globalThis;
  if(typeof globalThis.process==='undefined')globalThis.process={env:{NODE_ENV:${JSON.stringify(htmlNodeEnv)}},browser:true,version:'v18.0.0',versions:{},platform:'browser',cwd:function(){return'/'},nextTick:function(fn){setTimeout(fn,0)}};
})();
</script>`
      return html.includes('<head>') ? html.replace('<head>', `<head>\n${shimScript}`) : shimScript + html
    },
  }

  /**
   * Runs after vite-plugin-node-polyfills so absolute shim aliases win over its bare
   * package-id aliases in both resolve.alias and the Rolldown optimizeDeps graph.
   */
  const polyfillResolvePlugin: Plugin = {
    name: 'seed-protocol:polyfill-resolve',
    enforce: 'post',

    config(userConfig) {
      if (Object.keys(shimAliasObj).length === 0) return
      // Rewrite resolve.alias in place rather than returning it: this drops entries
      // (a returned list can only add), and Vite would concatenate a returned copy
      // onto the existing list, duplicating every alias.
      userConfig.resolve = {
        ...userConfig.resolve,
        alias: withPreferredPolyfillAliases(normalizeAliasEntries(userConfig.resolve?.alias), shimPaths),
      }
      return {
        optimizeDeps: {
          rolldownOptions: optimizeDepsRolldownPatch(undefined, {
            // Later merges overwrite vite-plugin-node-polyfills' serve-time
            // `global: 'global'` define and its bare shim-id aliases.
            define: { global: 'globalThis' },
            alias: shimAliasObj,
          }),
        },
      }
    },

    resolveId: {
      order: 'pre',
      handler(id) {
        if (id === 'vite-plugin-node-polyfills/shims/buffer' || id === 'buffer' || id === 'node:buffer') {
          return shimPaths.buffer ?? null
        }
        if (id === 'vite-plugin-node-polyfills/shims/global' || id === 'global') return shimPaths.global ?? null
        if (id === 'vite-plugin-node-polyfills/shims/process' || id === 'process' || id === 'node:process') {
          return shimPaths.process ?? null
        }
        return null
      },
    },

    transform: {
      // Must emit absolute shim paths: order "post" runs after import-analysis.
      order: 'post',
      handler(code) {
        const rewritten = rewriteBarePolyfillShimImports(code, shimPaths)
        return rewritten ? { code: rewritten, map: null } : null
      },
    },
  }

  // vite-plugin-node-polyfills ≥0.27 returns Plugin[]; older versions returned a single Plugin.
  const polyfills = nodePolyfills({
    exclude: ['readline'],
    // Not stream or crypto: those pull stream-browserify and break Vite SSR / React Router prerender.
    include: ['path', 'buffer', 'events', 'string_decoder', 'util'],
    globals: { Buffer: true, global: true, process: true },
    protocolImports: true,
  }) as unknown as Plugin | Plugin[]

  return [
    globalsPlugin,
    ...(Array.isArray(polyfills) ? polyfills : [polyfills]),
    // After nodePolyfills so its config() can overwrite the bare shim aliases.
    ...(Object.keys(shimAliasObj).length > 0 ? [polyfillResolvePlugin] : []),
  ]
}
