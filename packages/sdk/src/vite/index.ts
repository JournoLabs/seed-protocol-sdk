import type { Plugin, UserConfig } from 'vite'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const _req = createRequire(import.meta.url)

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

// Node.js globals that are undefined in browsers and will throw at runtime.
// Keyed by identifier; value is the safe typeof-guard pattern so we can skip those.
const BROWSER_DANGEROUS_GLOBALS: Record<string, RegExp> = {
  global:     /\btypeof\s+global\b/,
  process:    /\btypeof\s+process\b/,
  Buffer:     /\btypeof\s+Buffer\b/,
  __dirname:  /\btypeof\s+__dirname\b/,
  __filename: /\btypeof\s+__filename\b/,
}

/**
 * Strip JS string literals, template literals, and comments from source text
 * so that identifier searches don't false-positive on string content.
 * This is intentionally approximate — good enough for a lint-style warning pass.
 */
function stripStringsAndComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))   // /* block comments */
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))          // // line comments
    .replace(/`(?:[^`\\]|\\.)*`/gs, (m) => '`' + ' '.repeat(m.length - 2) + '`')  // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')   // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'")   // single-quoted strings
}

interface GlobalHit {
  global: string
  /** zero-based character offset in the stripped source */
  offset: number
  /** 1-based line number */
  line: number
  /** surrounding raw source for context */
  context: string
}

function findDangerousGlobals(rawCode: string): GlobalHit[] {
  const stripped = stripStringsAndComments(rawCode)
  const hits: GlobalHit[] = []

  for (const [name, typeofGuard] of Object.entries(BROWSER_DANGEROUS_GLOBALS)) {
    // Skip globalThis when checking 'global'
    const re = new RegExp(`(?<![.\\w$])\\b${name}\\b(?!This)(?![\\w$])`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) !== null) {
      const offset = m.index
      // Check for typeof guard in the ~20 chars before the match
      const before = stripped.slice(Math.max(0, offset - 20), offset)
      if (typeofGuard.test(before)) continue

      // Compute 1-based line number from raw source (positions are preserved because
      // we replace with equal-length spaces, so offsets are stable)
      const linesBefore = rawCode.slice(0, offset).split('\n')
      const line = linesBefore.length
      const colOffset = linesBefore[linesBefore.length - 1].length
      const rawLine = rawCode.split('\n')[line - 1] ?? ''
      const ctx = rawLine.slice(Math.max(0, colOffset - 40), colOffset + name.length + 40).trim()

      hits.push({ global: name, offset, line, context: ctx })
    }
  }

  return hits
}

const DEFAULT_FS_MODULES = [
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
]
const SDK_DIST_DIR = path.dirname(fileURLToPath(import.meta.url))
const ARWEAVE_SHIM_FILE = path.join(SDK_DIST_DIR, 'arweave-default-shim.js')

type AliasEntry = { find: string | RegExp; replacement: string }

function resolvePackageFile(packageName: string, relativePath: string): string | undefined {
  const candidates: string[] = []

  try {
    const pkgJson = _req.resolve(`${packageName}/package.json`)
    candidates.push(path.join(path.dirname(pkgJson), relativePath))
  } catch {
    // package may be hoisted/unavailable in this graph
  }

  const cwdNodeModules = path.join(process.cwd(), 'node_modules')
  candidates.push(path.join(cwdNodeModules, packageName, relativePath))

  const bunDir = path.join(cwdNodeModules, '.bun')
  if (fs.existsSync(bunDir)) {
    for (const entry of fs.readdirSync(bunDir)) {
      if (!entry.startsWith(`${packageName}@`)) continue
      candidates.push(path.join(bunDir, entry, `node_modules/${packageName}`, relativePath))
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

function normalizeAliasEntries(
  alias: NonNullable<UserConfig['resolve']>['alias'] | undefined
): AliasEntry[] {
  if (!alias) return []
  if (Array.isArray(alias)) {
    return alias
      .filter((entry): entry is AliasEntry => !!entry && !!(entry as AliasEntry).replacement)
      .map((entry) => ({ find: entry.find, replacement: entry.replacement }))
  }

  return Object.entries(alias).map(([find, replacement]) => ({
    find,
    replacement: String(replacement),
  }))
}

function mergeAliasEntries(existing: AliasEntry[], additions: AliasEntry[]): AliasEntry[] {
  const merged = [...existing]
  const keyOf = (find: string | RegExp) =>
    typeof find === 'string' ? `s:${find}` : `r:${find.toString()}`
  const seen = new Set(merged.map((entry) => keyOf(entry.find)))

  for (const entry of additions) {
    const key = keyOf(entry.find)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }

  return merged
}

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
      const aliasEntries: AliasEntry[] = []
      for (const mod of fsModules) {
        const isPromises = mod.includes('promises')
        const target = isPromises ? '@zenfs/core/promises' : '@zenfs/core'
        aliasEntries.push({ find: mod, replacement: target })
      }

      const eventEmitterEsm = resolvePackageFile('eventemitter3', 'dist/eventemitter3.esm.js')
      if (eventEmitterEsm) {
        aliasEntries.push(
          { find: 'eventemitter3', replacement: eventEmitterEsm },
          { find: 'eventemitter3/index.mjs', replacement: eventEmitterEsm },
          { find: 'eventemitter3/index.js', replacement: eventEmitterEsm },
        )
      }

      const arweaveBundle = resolvePackageFile('arweave', 'bundles/web.bundle.js')
      if (arweaveBundle) {
        aliasEntries.push(
          { find: /^arweave$/, replacement: ARWEAVE_SHIM_FILE },
          { find: /^arweave\/web\/index\.js$/, replacement: ARWEAVE_SHIM_FILE },
          { find: /^arweave\/bundles\/web\.bundle\.js$/, replacement: arweaveBundle },
        )
      }

      const existingResolve = userConfig.resolve ?? {}
      const mergedAlias = mergeAliasEntries(
        normalizeAliasEntries(existingResolve.alias),
        aliasEntries,
      )

      const desiredOptimizeIncludes = [
        '@zenfs/core',
        '@zenfs/dom',
        'kerium',
        'utilium',
        'memium',
        'readable-stream',
        'viem',
        'isows',
      ]
      const resolvableOptimizeIncludes = desiredOptimizeIncludes.filter(
        (dep) => !!resolvePackageFile(dep, 'package.json')
      )

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
          ...resolvableOptimizeIncludes,
        ],
        // Keep `global` shim in optimizer esbuild options; top-level Vite `define`
        // can be rejected by Rolldown in some consumer setups.
        esbuildOptions: {
          ...(userConfig.optimizeDeps?.esbuildOptions ?? {}),
          define: {
            ...(userConfig.optimizeDeps?.esbuildOptions?.define ?? {}),
            global: 'globalThis',
          },
        },
      }

      return {
        // Apply global → globalThis for Rollup production builds too.
        // optimizeDeps.esbuildOptions.define only covers the dev pre-bundle step;
        // this top-level define is picked up by @rollup/plugin-replace during build
        // and covers all chunks, including code-split migrator/commonjs-helper chunks.
        define: {
          ...(userConfig.define ?? {}),
          global: 'globalThis',
          // process is referenced by path-browserify (drizzle migrator's node:path dep)
          // and other CJS modules. Point at globalThis.process which is set by the
          // synchronous inline shim script injected into index.html before any modules load.
          'process.env.NODE_ENV': JSON.stringify('production'),
          'process.browser': 'true',
          'process.platform': '"browser"',
        },
        resolve: {
          ...existingResolve,
          alias: mergedAlias,
          // Prevent duplicate React/thirdweb instances when @seedprotocol/publish is workspace-linked.
          // Multiple copies break context (e.g. useActiveAccount must be used within ThirdwebProvider).
          // Also dedupe XState and Seed packages: two xstate copies cause Object.assign _version errors;
          // two @seedprotocol/sdk copies leave BaseDb.PlatformClass / Db.appDb on different module instances
          // ("App DB not found", undefined.$with on PostsPage).
          dedupe: Array.from(
            new Set([
              ...(existingResolve.dedupe ?? []),
              'react',
              'react-dom',
              'thirdweb',
              'xstate',
              '@xstate/react',
              '@seedprotocol/sdk',
              '@seedprotocol/react',
              '@seedprotocol/publish',
              '@seedprotocol/feed',
            ])
          ),
        },
        optimizeDeps,
      }
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
      const existingRolldownOptions = (existingBuild as Record<string, unknown>).rolldownOptions as
        | Record<string, unknown>
        | undefined
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

      const build: Record<string, unknown> = {
        ...existingBuild,
        commonjsOptions,
      }
      if (existingRolldownOptions) {
        build.rolldownOptions = {
          ...existingRolldownOptions,
          external: externalList,
        }
      } else {
        build.rollupOptions = rollupOptions
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

    generateBundle(_options, bundle) {
      const allHits: Array<{ chunk: string } & GlobalHit> = []

      for (const [chunkName, asset] of Object.entries(bundle)) {
        if (asset.type !== 'chunk') continue
        const hits = findDangerousGlobals(asset.code)
        for (const hit of hits) {
          allHits.push({ chunk: chunkName, ...hit })
        }
      }

      if (allHits.length === 0) return

      console.warn(
        '\n[seed-vite-plugin] ⚠️  Bare Node.js globals detected in browser bundle chunks.' +
        ' These will throw ReferenceError at runtime unless shimmed.\n'
      )
      const byChunk = new Map<string, typeof allHits>()
      for (const hit of allHits) {
        const list = byChunk.get(hit.chunk) ?? []
        list.push(hit)
        byChunk.set(hit.chunk, list)
      }
      for (const [chunk, hits] of byChunk) {
        console.warn(`  ${chunk}`)
        for (const h of hits) {
          console.warn(`    line ${h.line}: \`${h.global}\`  — ${h.context}`)
        }
      }
      console.warn('')
    },

    transformIndexHtml(html) {
      // Synchronous inline script runs before any <script type="module">, so
      // global and process are guaranteed to exist when CJS wrappers evaluate.
      // vite-plugin-node-polyfills injects polyfills via module imports, which
      // resolve too late for @rollup/plugin-commonjs-generated wrapper code.
      const shimScript = `<script>
(function(){
  if(typeof globalThis.global==='undefined')globalThis.global=globalThis;
  if(typeof globalThis.process==='undefined')globalThis.process={env:{NODE_ENV:'production'},browser:true,version:'v18.0.0',versions:{},platform:'browser',cwd:function(){return'/'},nextTick:function(fn){setTimeout(fn,0)}};
})();
</script>`

      let result = html
      if (result.includes('<head>')) {
        result = result.replace('<head>', `<head>\n${shimScript}`)
      } else {
        result = shimScript + result
      }

      if (!autoInit) return result

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

      if (result.includes('</head>')) {
        return result.replace('</head>', `${initScript}\n</head>`)
      }

      return result + initScript
    },
  }

  const plugins: Plugin[] = [configPlugin, mainPlugin]

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
