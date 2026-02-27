import type { Plugin, UserConfig } from 'vite'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const _req = createRequire(import.meta.url)

function resolveXstateDep(id: string, importer?: string): string | null {
  const searchPaths: string[] = [process.cwd()]
  if (importer) {
    let dir = path.dirname(importer)
    for (let i = 0; i < 5 && dir; i++) {
      searchPaths.push(dir)
      dir = path.dirname(dir)
    }
  }
  const sdkDir = path.resolve(fileURLToPath(import.meta.url), '../../..')
  searchPaths.push(sdkDir, path.resolve(sdkDir, '../..'))
  for (const dir of searchPaths) {
    try {
      return _req.resolve(id, { paths: [dir] })
    } catch {
      continue
    }
  }
  return null
}

// #region agent log
const _dbg = (d: { hypothesisId?: string; location: string; message: string; data?: object }) => {
  fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '73e96f' },
    body: JSON.stringify({
      sessionId: '73e96f',
      ...d,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
}
// #endregion

export interface SeedVitePluginOptions {
  /**
   * Additional modules to alias to ZenFS equivalents.
   * @default ['fs', 'fs/promises', 'node:fs', 'node:fs/promises']
   */
  fsModules?: string[]

  /**
   * Whether to inject automatic ZenFS initialization script into index.html.
   * When true, injects a &lt;script type="module"&gt; that imports from '@zenfs/core'/'@zenfs/dom'.
   * Browsers cannot resolve those bare specifiers, so the script fails at runtime unless you use
   * an import map or load ZenFS another way. Prefer false and initialize ZenFS in your entry:
   * import { configure } from '@zenfs/core'; import { IndexedDB } from '@zenfs/dom';
   * await configure({ mounts: { '/': IndexedDB } });
   * @default false
   */
  autoInit?: boolean

  /**
   * Enable debug logging.
   * @default false
   */
  debug?: boolean

  /**
   * Whether to automatically include vite-plugin-node-polyfills with sensible defaults.
   * @default true
   */
  includeNodePolyfills?: boolean
}

const DEFAULT_FS_MODULES = [
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
]

/**
 * Minimal Vite plugin to make the SDK work in browser/Electron renderer:
 * - Aliases fs → @zenfs/core (and promises variant)
 * - Aliases path → path-browserify
 * - Ensures CommonJS in SDK dist is transformed by Vite's CommonJS plugin
 * - Optionally injects a simple ZenFS initialization script
 * - Optionally wires up vite-plugin-node-polyfills with safe defaults
 *
 * This plugin assumes the SDK does not bundle Node-only code in the browser entry.
 * For Electron, Node-only work (e.g. drizzle-kit, better-sqlite3) should run in the
 * main process; the renderer should only use browser-safe SDK usage.
 *
 * For the renderer build:
 * - Use the SDK's ESM entry: import from '@seedprotocol/sdk' (resolves to dist/main.js).
 * - When autoInit is false (default), initialize ZenFS in your entry:
 *   import { configure } from '@zenfs/core'; import { IndexedDB } from '@zenfs/dom';
 *   await configure({ mounts: { '/': IndexedDB } });
 */
export function seedVitePlugin(options: SeedVitePluginOptions = {}): Plugin[] {
  // #region agent log
  _dbg({
    hypothesisId: 'D',
    location: 'vite/index.ts:seedVitePlugin',
    message: 'seedVitePlugin loaded',
    data: { options: Object.keys(options) },
  })
  // #endregion
  const {
    fsModules = DEFAULT_FS_MODULES,
    autoInit = false,
    debug = false,
    includeNodePolyfills = true,
  } = options

  const log = (...args: unknown[]) => {
  }

  /**
   * Pre-plugin: configure aliases and optimizeDeps.
   */
  const configPlugin: Plugin = {
    name: 'seed-protocol:config',
    enforce: 'pre',

    config(userConfig) {
      const alias: Record<string, string> = {
        // Always use browser-friendly path implementation
        // path: 'path-browserify',
      }

      // Resolve @xstate/react transitive deps for production builds (optimizeDeps only helps dev).
      // Bun/workspace layouts can leave these in virtual store; Rollup fails to resolve them.
      const xstateDepIds = [
        'use-isomorphic-layout-effect',
        'use-sync-external-store',
        'use-sync-external-store/shim',
        'use-sync-external-store/shim/with-selector',
      ]
      let xstateResolved = 0
      for (const id of xstateDepIds) {
        // const resolved = resolveXstateDep(id)
        // if (resolved) {
        //   alias[id] = resolved
        //   xstateResolved++
        // }
      }
      if (xstateResolved > 0) {
        // #region agent log
        _dbg({
          hypothesisId: 'fix',
          location: 'vite/index.ts:configPlugin.alias',
          message: 'resolve.alias added for @xstate/react deps',
          data: { aliasKeys: Object.keys(alias) },
        })
        // #endregion
      } else {
        // #region agent log
        _dbg({
          hypothesisId: 'fix',
          location: 'vite/index.ts:configPlugin.alias',
          message: 'failed to resolve any @xstate/react deps',
          data: { cwd: process.cwd() },
        })
        // #endregion
      }

      for (const mod of fsModules) {
        const isPromises = mod.includes('promises')
        const target = isPromises ? '@zenfs/core/promises' : '@zenfs/core'
        alias[mod] = target
      }

      // Merge with any existing aliases
      const existingAlias = userConfig.resolve?.alias
      if (Array.isArray(existingAlias)) {
        for (const [key, value] of Object.entries(alias)) {
          existingAlias.push({ find: key, replacement: value })
        }
      }

      const optimizeDeps: UserConfig['optimizeDeps'] = {
        ...(userConfig.optimizeDeps ?? {}),
        exclude: [
          ...(userConfig.optimizeDeps?.exclude ?? []),
          // Do not prebundle the SDK itself or clearly node-only tools
          '@seedprotocol/sdk',
          'drizzle-kit',
          'drizzle-orm',
          'better-sqlite3',
          // sqlocal uses workers and should not be prebundled
          'sqlocal',
        ],
        include: [
          ...(userConfig.optimizeDeps?.include ?? []),
          // Ensure ZenFS packages are discoverable
          '@zenfs/core',
          '@zenfs/dom',
          // Dependencies of @zenfs/core; must be pre-bundled for resolution
          'kerium',
          'utilium',
          'memium',
          'readable-stream',
          // viem dynamically imports isows; pre-bundle both so Rollup can resolve them
          'viem',
          'isows',
          // @xstate/react transitive deps; must be pre-bundled so Rollup can resolve them
          // (Bun/workspace layouts can leave these in virtual store, breaking resolution)
          'use-isomorphic-layout-effect',
          'use-sync-external-store',
        ],
      }

      // #region agent log
      _dbg({
        hypothesisId: 'A,B',
        location: 'vite/index.ts:configPlugin.config',
        message: 'configPlugin returning optimizeDeps',
        data: {
          optimizeDepsInclude: optimizeDeps.include,
          userOptimizeDepsInclude: userConfig.optimizeDeps?.include,
        },
      })
      // #endregion

      return {
        resolve: {
          alias,
          // Prevent duplicate React/thirdweb instances when @seedprotocol/publish is workspace-linked.
          // Multiple copies break context (e.g. useActiveAccount must be used within ThirdwebProvider).
          dedupe: ['react', 'react-dom', 'thirdweb'],
        },
        optimizeDeps,
      }
    },
    configResolved(resolvedConfig) {
      // #region agent log
      _dbg({
        hypothesisId: 'B',
        location: 'vite/index.ts:configPlugin.configResolved',
        message: 'final merged optimizeDeps',
        data: {
          include: resolvedConfig.optimizeDeps?.include,
          exclude: resolvedConfig.optimizeDeps?.exclude,
        },
      })
      // #endregion
    },
  }

  /**
   * Post-plugin: build configuration + optional ZenFS init.
   */
  const mainPlugin: Plugin = {
    name: 'seed-protocol:main',
    enforce: 'post',

    config(userConfig) {
      const existingBuild = userConfig.build ?? {}
      const existingCommonjs = existingBuild.commonjsOptions ?? {}
      const existingRollupOptions = existingBuild.rollupOptions ?? {}
      const existingExternal = existingRollupOptions.external ?? []

      const include = [
        // Anything the user already had
        ...(Array.isArray(existingCommonjs.include)
          ? existingCommonjs.include
          : existingCommonjs.include
          ? [existingCommonjs.include]
          : []),
        // Always process node_modules and the SDK dist so require() is transformed
        /node_modules/,
        /seed-protocol-sdk[\\/]+dist[\\/]/,
      ]

      // Exclude packages that are already ESM or have special worker handling
      const exclude = [
        ...(Array.isArray(existingCommonjs.exclude)
          ? existingCommonjs.exclude
          : existingCommonjs.exclude
          ? [existingCommonjs.exclude]
          : []),
        // sqlocal is ESM and uses workers - don't transform it
        /node_modules[\\/]+sqlocal[\\/]/,
      ]

      const commonjsOptions = {
        ...existingCommonjs,
        include,
        exclude,
        transformMixedEsModules: true,
      }

      // Externalize Node.js-only dev/build tools that should never be bundled
      const nodeOnlyPackages = [
        'drizzle-kit',
        'better-sqlite3', // Native SQLite binding (Node.js only)
        // Database drivers that drizzle-kit dynamically imports (should not be bundled)
        '@electric-sql/pglite',
        'pg',
        'postgres',
        '@vercel/postgres',
        '@neondatabase/serverless',
        'mysql2',
        'mysql2/promise',
        '@planetscale/database',
      ]

      const isNodeOnlyExternal = (id: string) =>
        nodeOnlyPackages.some(
          (pkg) =>
            id === pkg ||
            id.startsWith(`${pkg}/`) ||
            id.includes(`/${pkg}/`) ||
            id.endsWith(`/${pkg}`)
        )

      const externalList = (id: string, importer?: string, isResolved?: boolean) => {
        if (isNodeOnlyExternal(id)) return true
        if (typeof existingExternal === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (existingExternal as any)(id, importer, isResolved ?? false)
        }
        if (Array.isArray(existingExternal)) {
          return existingExternal.some((ext) => ext === id || id.startsWith(`${ext}/`))
        }
        return false
      }

      const rollupOptions = {
        ...existingRollupOptions,
        external: externalList,
      }

      const build = {
        ...existingBuild,
        commonjsOptions,
        rollupOptions,
      }

      // Worker options are TOP-LEVEL in Vite config, not under build.
      // Default 'iife' breaks when workers use code-splitting (e.g. sqlocal).
      const existingWorker = userConfig.worker ?? {}
      const worker = {
        ...existingWorker,
        format: existingWorker.format ?? 'es',
      }

      return {
        build,
        worker,
      }
    },

    transformIndexHtml(html) {
      if (!autoInit) return html

      const initScript = `
<script type="module">
import { configure } from '@zenfs/core';
import { IndexedDB } from '@zenfs/dom';

if (!window.__seedFsReady) {
  window.__seedFsReady = configure({
    mounts: { '/': IndexedDB },
  }).catch((err) => {
    console.error('[seed-vite-plugin] ZenFS initialization failed', err);
  });
}
</script>`

      if (html.includes('</head>')) {
        return html.replace('</head>', `${initScript}\n</head>`)
      }

      return html + initScript
    },
  }

  const resolveXstateDepsPlugin: Plugin = {
    name: 'seed-protocol:resolve-xstate-deps',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'use-isomorphic-layout-effect' || id.startsWith('use-sync-external-store')) {
        const resolved = resolveXstateDep(id, importer)
        if (resolved) {
          // #region agent log
          _dbg({
            hypothesisId: 'fix',
            location: 'vite/index.ts:resolveXstateDepsPlugin',
            message: 'resolved @xstate/react dep',
            data: { id, resolved },
          })
          // #endregion
          return resolved
        }
        // #region agent log
        _dbg({
          hypothesisId: 'fix',
          location: 'vite/index.ts:resolveXstateDepsPlugin',
          message: 'failed to resolve @xstate/react dep',
          data: { id, importer: importer ?? 'unknown' },
        })
        // #endregion
      }
      return null
    },
  }

  const plugins: Plugin[] = [configPlugin, resolveXstateDepsPlugin, mainPlugin]

  if (includeNodePolyfills) {
    log('Including vite-plugin-node-polyfills with default settings')
    plugins.push(
      nodePolyfills({
        // Let fs be handled by @zenfs/core instead of polyfills
        exclude: ['readline',],
        // Common set of browser-friendly polyfills used by many deps
        include: ['path', 'crypto', 'stream', 'util', 'buffer', 'events', 'string_decoder',],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
        protocolImports: true,
      }) as unknown as Plugin,
    )
  }

  return plugins
}
