import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import {
  effectiveIsolationHeaders,
  isolationHeadersNotSetBy,
  resolveIsolationHeaders,
  zenfsModuleFor,
} from '@seedprotocol/bundler-core'
import { appendAliases } from './aliases'
import { warnAboutNodeGlobals } from './nodeGlobals'
import { nodePolyfillPlugins } from './nodePolyfills'

export interface SeedVitePluginOptions {
  /**
   * Cross-origin isolation headers for SQLite WASM, SharedArrayBuffer and OPFS on the dev and
   * preview servers, also applied in `writeHead` because Vite's `server.headers` is not copied
   * onto React Router Framework Mode HTML responses. Without them the SDK can't keep its
   * database in OPFS. Set `false` to disable, or pass `{ coop, coep, corp }` to override values.
   * A COOP/COEP/CORP value you set in `server.headers` or `preview.headers` (any letter case)
   * wins for that server.
   * @default true (`COOP: same-origin`, `COEP: credentialless`, `CORP: same-origin`)
   */
  isolationHeaders?: boolean | {
    coop?: string
    coep?: string
    corp?: string
  }

  /**
   * Add vite-plugin-node-polyfills (`path`, `buffer`, `events`, `string_decoder`, `util`,
   * `timers`, and the `Buffer` / `process` / `global` globals), a `stream` stub and inline `global` /
   * `process` shims in index.html. The SDK doesn't need them; turn this on when another
   * dependency of your app uses Node built-ins in the browser.
   * @default false
   */
  includeNodePolyfills?: boolean

  /**
   * Modules to alias to ZenFS (`@zenfs/core`, or `@zenfs/core/promises` for ids containing
   * "promises"), for app code or dependencies that import Node's `fs` in the browser. The SDK's
   * browser build doesn't.
   * @default []
   */
  fsModules?: string[]

  /**
   * Log what the plugin adds, and warn about Node-only globals left in production chunks.
   * @default false
   */
  debug?: boolean
}

/**
 * Packages deduplicated when the app root resolves them, so a linked or workspace Seed package
 * shares the app's copies instead of loading its own: two Reacts break hooks, two thirdweb
 * copies break its provider context, and two copies of a Seed package split its module state
 * (registered clients, the app DB). A package only nested under another one is left alone:
 * Vite resolves deduplicated packages from the root.
 */
const DEDUPE_CANDIDATES = [
  'react',
  'react-dom',
  'thirdweb',
  'xstate',
  '@xstate/react',
  '@zenfs/core',
  '@zenfs/dom',
  '@seedprotocol/sdk',
  '@seedprotocol/react',
  '@seedprotocol/publish',
  '@seedprotocol/feed',
  '@seedprotocol/eas',
  '@seedprotocol/arweave',
  '@seedprotocol/query',
] as const

/**
 * The directory of `packageName` in the nearest node_modules folder from `fromDir` upward, the
 * way Vite and Node look packages up. Found on disk rather than with `require.resolve`, which
 * adds NODE_PATH (pnpm's bin shims point it at node_modules/.pnpm/node_modules, which Vite
 * doesn't search) and can't resolve ESM-only packages such as sqlocal.
 */
function findPackageDir(packageName: string, fromDir: string): string | undefined {
  let dir = path.resolve(fromDir)
  for (;;) {
    const candidate = path.join(dir, 'node_modules', packageName)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Directories the dev server serves SDK files from: the SDK package, and sqlocal and SQLite
 * WASM (its database worker and WASM file). They are outside Vite's default `server.fs.allow`
 * when the SDK is linked into the app (`file:`, `link:`, a workspace) or lives in a package
 * manager store, and the worker request then fails with 403.
 */
function sdkServePaths(appRoot: string): string[] {
  const installed = findPackageDir('@seedprotocol/sdk', appRoot)
  if (!installed) return []
  // Real paths: a linked or store-installed package is a symlink, and Vite checks real paths.
  const dirs = [fs.realpathSync(installed)]
  // Each from the package that imports it: the SDK imports sqlocal, which imports SQLite WASM.
  for (const pkg of ['sqlocal', '@sqlite.org/sqlite-wasm']) {
    const dir = findPackageDir(pkg, dirs[dirs.length - 1]!)
    if (dir) dirs.push(fs.realpathSync(dir))
  }
  return dirs
}

/** Real paths of the Seed packages the app resolves: the SDK and the packages it imports. */
function seedPackageDirs(appRoot: string): string[] {
  const dirs: string[] = []
  for (const pkg of ['@seedprotocol/sdk', '@seedprotocol/react', '@seedprotocol/query', '@seedprotocol/eas', '@seedprotocol/arweave']) {
    const dir = findPackageDir(pkg, appRoot) ?? (dirs[0] ? findPackageDir(pkg, dirs[0]) : undefined)
    if (dir) dirs.push(fs.realpathSync(dir))
  }
  return dirs
}

function isCoveredBy(allow: readonly string[], dir: string): boolean {
  return allow.some((entry) => {
    const parent = path.resolve(String(entry))
    return dir === parent || dir.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
  })
}

function applyIsolationHeaderMiddleware(
  server: ViteDevServer | PreviewServer,
  headers: Record<string, string>,
): void {
  server.middlewares.use((_req, res, next) => {
    const apply = () => {
      for (const [key, value] of Object.entries(headers)) {
        if (!res.getHeader(key)) res.setHeader(key, value)
      }
    }
    const originalWriteHead = res.writeHead.bind(res)
    res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
      apply()
      return originalWriteHead(...args)
    }) as typeof res.writeHead
    apply()
    next()
  })
}

const KNOWN_OPTIONS = new Set(['fsModules', 'debug', 'includeNodePolyfills', 'isolationHeaders'])

/**
 * The Vite settings a browser app using @seedprotocol/sdk needs: cross-origin isolation headers
 * on the dev and preview servers, ES module workers, in-order dev pre-bundles, and, for SDK
 * packages installed outside the app root, deduplication and dev-server file access. Node polyfills and `fs` aliases are
 * opt-in.
 */
export function seedVitePlugin(options: SeedVitePluginOptions = {}): Plugin[] {
  for (const key of Object.keys(options)) {
    if (KNOWN_OPTIONS.has(key)) continue
    throw new Error(
      key === 'autoInit'
        ? "seedVitePlugin: autoInit was removed. Initialize the SDK from your app (client.init(), or <SeedProvider>)."
        : `seedVitePlugin: unknown option "${key}". It takes ${[...KNOWN_OPTIONS].join(', ')}.`,
    )
  }
  const {
    fsModules = [],
    debug = false,
    includeNodePolyfills = false,
    isolationHeaders: isolationHeadersOption,
  } = options

  const isolationHeaders = resolveIsolationHeaders(isolationHeadersOption)
  // Replaced in configResolved by the values the user's server/preview headers leave us.
  let serverIsolationHeaders = isolationHeaders
  let previewIsolationHeaders = isolationHeaders

  const log = (...args: unknown[]) => {
    if (debug) console.log('[seed-vite-plugin]', ...args)
  }
  // Real paths of the installed Seed packages, set in configResolved: `debug` skips their chunks.
  let sdkPackageDirs: string[] = []

  const configPlugin: Plugin = {
    name: 'seed-protocol:config',
    enforce: 'pre',

    config(userConfig) {
      appendAliases(
        userConfig,
        fsModules.map((mod) => ({ find: mod, replacement: zenfsModuleFor(mod) })),
      )

      const appRoot = path.resolve(userConfig.root ?? process.cwd())
      const userDedupe = new Set(userConfig.resolve?.dedupe ?? [])
      const dedupe = DEDUPE_CANDIDATES.filter(
        (pkg) => !userDedupe.has(pkg) && findPackageDir(pkg, appRoot) !== undefined,
      )
      log('resolve.dedupe:', dedupe)

      // Only this plugin's additions: Vite deep-merges them into the user's config and
      // concatenates arrays.
      return {
        resolve: { dedupe },
        // drizzle-orm's modules import each other in a cycle. When the app imports both
        // @seedprotocol/sdk and @seedprotocol/sdk/drizzle, the dev pre-bundle splits them across
        // chunks that can run out of order, and drizzle throws "Cannot read properties of
        // undefined (reading 'Symbol')" at startup. Production builds aren't affected.
        ...(userConfig.optimizeDeps?.rolldownOptions?.output &&
        'strictExecutionOrder' in userConfig.optimizeDeps.rolldownOptions.output
          ? {}
          : { optimizeDeps: { rolldownOptions: { output: { strictExecutionOrder: true } } } }),
        // SQLite's worker code-splits, which the default 'iife' worker format can't do: the
        // database never opens in a production build.
        ...(userConfig.worker?.format ? {} : { worker: { format: 'es' as const } }),
        // Only the headers the user has not set. Preview falls back to server.headers when
        // preview.headers is unset, so only touch preview.headers when the user set it.
        ...(isolationHeaders
          ? {
              server: {
                headers: isolationHeadersNotSetBy(isolationHeaders, userConfig.server?.headers),
              },
              ...(userConfig.preview?.headers
                ? {
                    preview: {
                      headers: isolationHeadersNotSetBy(isolationHeaders, userConfig.preview.headers),
                    },
                  }
                : {}),
            }
          : {}),
      }
    },

    configResolved(resolvedConfig) {
      if (isolationHeaders) {
        serverIsolationHeaders = effectiveIsolationHeaders(isolationHeaders, resolvedConfig.server.headers)
        previewIsolationHeaders = effectiveIsolationHeaders(isolationHeaders, resolvedConfig.preview.headers)
      }
      sdkPackageDirs = seedPackageDirs(resolvedConfig.root)
      if (resolvedConfig.command !== 'serve') return
      const allow = resolvedConfig.server.fs.allow
      const added = sdkServePaths(resolvedConfig.root).filter((dir) => !isCoveredBy(allow, dir))
      allow.push(...added)
      if (added.length > 0) log('server.fs.allow += ', added)
    },

    configureServer(server) {
      if (serverIsolationHeaders) applyIsolationHeaderMiddleware(server, serverIsolationHeaders)
    },

    configurePreviewServer(server) {
      if (previewIsolationHeaders) applyIsolationHeaderMiddleware(server, previewIsolationHeaders)
    },

    generateBundle(_options, bundle) {
      if (debug) {
        warnAboutNodeGlobals(
          bundle as Record<string, { type: string; code?: string; moduleIds?: readonly string[] }>,
          sdkPackageDirs,
        )
      }
    },
  }

  return [configPlugin, ...(includeNodePolyfills ? nodePolyfillPlugins(log) : [])]
}
