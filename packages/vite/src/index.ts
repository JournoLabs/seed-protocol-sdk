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
   * The SDK depends on that package and aliases its injected shim imports to absolute
   * paths, so consuming apps do not need to install vite-plugin-node-polyfills themselves.
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
      const colOffset = linesBefore.at(-1)?.length ?? 0
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
const DEBUG_SHIM_FILE = path.join(SDK_DIST_DIR, 'debug-default-shim.js')

/** Fragile renderer deps pre-bundled for stable CJS/ESM interop (aligned with permapress). */
const FRAGILE_RENDERER_OPTIMIZE_INCLUDES = [
  'debug',
  'random',
  'seedrandom',
  '@georgedoescode/generative-utils',
  'nanoid-dictionary',
] as const

/**
 * Always force-include (do not gate on resolvePackageFile): under bun these live nested
 * under @seedprotocol/sdk, and eas-sdk's ESM named-imports CJS eas-contracts. Without
 * prebundling, Vite serves raw /@fs CJS and the browser throws
 * "does not provide an export named 'EAS__factory'" during SchemaEncoder encode.
 */
const EAS_OPTIMIZE_INCLUDES = [
  '@seedprotocol/sdk > @ethereum-attestation-service/eas-sdk',
  '@seedprotocol/sdk > @ethereum-attestation-service/eas-sdk > @ethereum-attestation-service/eas-contracts',
] as const

type AliasEntry = { find: string | RegExp; replacement: string }

function pushBunPackageCandidates(
  bunDir: string,
  packageName: string,
  relativePath: string,
  candidates: string[],
): void {
  if (!fs.existsSync(bunDir)) return
  // Nested scopes (@scope/name) live under .bun as @scope+name@version/...
  const bunPrefix = packageName.startsWith('@')
    ? packageName.replace('/', '+')
    : packageName
  for (const entry of fs.readdirSync(bunDir)) {
    if (!entry.startsWith(`${bunPrefix}@`) && !entry.startsWith(`${packageName}@`)) continue
    candidates.push(path.join(bunDir, entry, `node_modules/${packageName}`, relativePath))
  }
}

function resolvePackageFile(packageName: string, relativePath: string): string | undefined {
  const candidates: string[] = []
  const sdkRoot = path.resolve(SDK_DIST_DIR, '..')

  try {
    const pkgJson = _req.resolve(`${packageName}/package.json`)
    candidates.push(path.join(path.dirname(pkgJson), relativePath))
  } catch {
    // Many packages (e.g. sqlocal) omit package.json from "exports". Resolve an
    // entry file and walk up to the package root instead.
    try {
      const entry = _req.resolve(packageName)
      let dir = path.dirname(entry)
      for (let i = 0; i < 8; i++) {
        const pkgJsonPath = path.join(dir, 'package.json')
        if (fs.existsSync(pkgJsonPath)) {
          try {
            const pkgName = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).name
            if (pkgName === packageName) {
              candidates.push(path.join(dir, relativePath))
              break
            }
          } catch {
            // ignore invalid package.json
          }
        }
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    } catch {
      // package may be hoisted/unavailable in this graph
    }
  }

  // Linked/file installs: deps often live under the SDK package, not the app cwd.
  candidates.push(path.join(sdkRoot, 'node_modules', packageName, relativePath))

  const cwdNodeModules = path.join(process.cwd(), 'node_modules')
  candidates.push(path.join(cwdNodeModules, packageName, relativePath))

  pushBunPackageCandidates(
    path.join(cwdNodeModules, '.bun'),
    packageName,
    relativePath,
    candidates,
  )
  pushBunPackageCandidates(
    path.join(sdkRoot, 'node_modules', '.bun'),
    packageName,
    relativePath,
    candidates,
  )
  const bunInstallRoot = findNodeModulesBunRoot(sdkRoot)
  if (bunInstallRoot) {
    pushBunPackageCandidates(
      path.join(bunInstallRoot, 'node_modules', '.bun'),
      packageName,
      relativePath,
      candidates,
    )
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

/** Walk up from startDir looking for a directory that contains node_modules/.bun. */
function findNodeModulesBunRoot(startDir: string): string | undefined {
  let dir = path.resolve(startDir)
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'node_modules', '.bun'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function isFsAllowCovering(allow: readonly string[], filePath: string): boolean {
  const child = path.resolve(filePath)
  return allow.some((uri) => {
    const parent = path.resolve(String(uri))
    return (
      child === parent ||
      child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
    )
  })
}

function realpathOrResolve(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/**
 * When the SDK is linked (file:/symlink) into an external app, sqlocal's worker
 * and sqlite-wasm assets resolve into the SDK install tree (often bun's .bun
 * store). Vite's default server.fs.allow only covers the consumer workspace, so
 * those absolute /@fs requests 403 unless we allowlist the install roots.
 */
function collectDevServerFsAllowPaths(): string[] {
  const paths = new Set<string>()
  const add = (p?: string) => {
    if (!p) return
    paths.add(realpathOrResolve(p))
  }

  let sdkPkgDir: string
  try {
    sdkPkgDir = path.dirname(_req.resolve('@seedprotocol/sdk/package.json'))
  } catch {
    sdkPkgDir = path.resolve(SDK_DIST_DIR, '..')
  }
  add(sdkPkgDir)

  const bunInstallRoot = findNodeModulesBunRoot(sdkPkgDir)
  if (bunInstallRoot) add(bunInstallRoot)

  for (const pkg of ['sqlocal', '@sqlite.org/sqlite-wasm'] as const) {
    const pkgJson = resolvePackageFile(pkg, 'package.json')
    if (pkgJson) add(path.dirname(pkgJson))
  }

  return [...paths]
}

function ensureDevServerFsAllow(allow: string[]): string[] {
  const added: string[] = []
  for (const dir of collectDevServerFsAllowPaths()) {
    if (isFsAllowCovering(allow, dir)) continue
    allow.push(dir)
    added.push(dir)
  }
  return added
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

/**
 * Collapse repeated vite-plugin-node-polyfills globals banners (Vite 8 optimizer + serve).
 * Re-inject with absolute ESM paths: this runs in transform order "post" (after
 * import-analysis), so bare package ids would reach the browser unresolved
 * ("Relative references must start with /, ./, or ../").
 */
function dedupeNodePolyfillBanner(
  code: string,
  paths: NodePolyfillShimPaths,
): string | null {
  const importCount = (code.match(/import\s+__buffer_polyfill\b/g) || []).length
  if (importCount <= 1) return null
  if (!paths.buffer || !paths.global || !paths.process) return null

  const bannerRe =
    /import\s+__buffer_polyfill\s+from\s+['"][^'"]+['"];?\s*\n\s*globalThis\.Buffer\s*=\s*globalThis\.Buffer\s*\|\|\s*__buffer_polyfill;?\s*\n\s*import\s+__global_polyfill\s+from\s+['"][^'"]+['"];?\s*\n\s*globalThis\.global\s*=\s*globalThis\.global\s*\|\|\s*__global_polyfill;?\s*\n\s*import\s+__process_polyfill\s+from\s+['"][^'"]+['"];?\s*\n\s*globalThis\.process\s*=\s*globalThis\.process\s*\|\|\s*__process_polyfill;?\s*\n?/g

  const cleaned = code.replace(bannerRe, '')
  if (cleaned === code) return null

  const banner =
    `import __buffer_polyfill from ${JSON.stringify(paths.buffer)};\n` +
    'globalThis.Buffer = globalThis.Buffer || __buffer_polyfill;\n' +
    `import __global_polyfill from ${JSON.stringify(paths.global)};\n` +
    'globalThis.global = globalThis.global || __global_polyfill;\n' +
    `import __process_polyfill from ${JSON.stringify(paths.process)};\n` +
    'globalThis.process = globalThis.process || __process_polyfill;\n'

  return banner + cleaned
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

function addRendererCompatibilityAliases(aliasEntries: AliasEntry[]): void {
  const nanoidDictionaryEsm = resolvePackageFile(
    'nanoid-dictionary',
    'dist/dictionary.esm.js',
  )
  if (nanoidDictionaryEsm) {
    aliasEntries.push({
      find: /^nanoid-dictionary$/,
      replacement: nanoidDictionaryEsm,
    })
  }

  const zenfsCoreIndex = resolvePackageFile('@zenfs/core', 'dist/index.js')
  const zenfsCorePath = resolvePackageFile('@zenfs/core', 'dist/path.js')
  if (zenfsCoreIndex) {
    aliasEntries.push({ find: /^@zenfs\/core$/, replacement: zenfsCoreIndex })
  }
  if (zenfsCorePath) {
    aliasEntries.push({ find: /^@zenfs\/core\/path$/, replacement: zenfsCorePath })
  }

  const zenfsDomIndex = resolvePackageFile('@zenfs/dom', 'dist/index.js')
  if (zenfsDomIndex) {
    aliasEntries.push({ find: /^@zenfs\/dom$/, replacement: zenfsDomIndex })
  }

  if (fs.existsSync(DEBUG_SHIM_FILE)) {
    // Only alias the package root. Do not alias debug/src/browser.js to this shim:
    // the shim imports that path and aliasing it back creates a circular module.
    aliasEntries.push({ find: /^debug$/, replacement: DEBUG_SHIM_FILE })
  }

  const debugBrowserEntry = resolvePackageFile('debug', 'src/browser.js')
  if (debugBrowserEntry) {
    aliasEntries.push({
      find: /^debug\/src\/browser\.js$/,
      replacement: debugBrowserEntry,
    })
  }
}

/** Object-form aliases for optimizeDeps pre-bundle (debug shim subpath). */
function debugShimOptimizeAliasObject(): Record<string, string> {
  const debugBrowserEntry = resolvePackageFile('debug', 'src/browser.js')
  return debugBrowserEntry ? { 'debug/src/browser.js': debugBrowserEntry } : {}
}

type OptimizeDepsConfig = NonNullable<UserConfig['optimizeDeps']>

/** Read Rolldown optimizer options, falling back to deprecated rollup/esbuild shapes. */
function readOptimizeDepsRolldownBase(
  existing: OptimizeDepsConfig | undefined,
): Record<string, unknown> {
  const opt = existing ?? {}
  return (
    opt.rolldownOptions ??
    (opt as { rollupOptions?: Record<string, unknown> }).rollupOptions ??
    {}
  ) as Record<string, unknown>
}

/**
 * Merge Vite 8 `optimizeDeps.rolldownOptions` without returning deprecated
 * `esbuildOptions` / `rollupOptions` keys from plugin config hooks.
 */
function mergeOptimizeDepsRolldownOptions(
  existing: OptimizeDepsConfig | undefined,
  patch: {
    define?: Record<string, string>
    alias?: Record<string, string>
  },
): OptimizeDepsConfig['rolldownOptions'] {
  const base = readOptimizeDepsRolldownBase(existing)
  const existingResolve = (base.resolve as { alias?: Record<string, string> } | undefined) ?? {}
  const existingTransform = (base.transform as { define?: Record<string, string> } | undefined) ?? {}
  const legacyDefine = existing?.esbuildOptions?.define ?? {}

  const mergedDefine = {
    ...legacyDefine,
    ...existingTransform.define,
    ...patch.define,
  }
  const mergedAlias = {
    ...existingResolve.alias,
    ...patch.alias,
  }

  return {
    ...base,
    ...(Object.keys(mergedDefine).length > 0
      ? {
          transform: {
            ...existingTransform,
            define: mergedDefine,
          },
        }
      : {}),
    ...(Object.keys(mergedAlias).length > 0
      ? {
          resolve: {
            ...existingResolve,
            alias: mergedAlias,
          },
        }
      : {}),
  }
}

/** Spread optimizeDeps while omitting deprecated optimizer option keys. */
function omitDeprecatedOptimizeDepsKeys(
  existing: OptimizeDepsConfig | undefined,
): Omit<OptimizeDepsConfig, 'esbuildOptions' | 'rollupOptions'> {
  const { esbuildOptions: _e, rollupOptions: _r, ...rest } = existing ?? {}
  return rest
}

/**
 * Minimal Vite plugin to make the SDK work in browser/Electron renderer:
 * - Aliases fs → @zenfs/core (and promises variant)
 * - Aliases path → path-browserify
 * - Ensures CommonJS in SDK dist is transformed by Vite's CommonJS plugin
 * - Allowlists linked SDK / sqlocal worker paths on server.fs.allow for Vite dev
 * - Optionally injects a simple ZenFS initialization script
 * - Optionally wires up vite-plugin-node-polyfills with safe defaults
 *
 * This plugin assumes the SDK does not bundle Node-only code in the browser entry.
 * For Electron, Node-only work (e.g. better-sqlite3) should run in the
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
    if (debug) console.log('[seed-vite-plugin]', ...args)
  }

  const { paths: polyfillShimPaths, unresolved: unresolvedPolyfillShims } =
    resolveNodePolyfillShimPaths()
  const polyfillShimAliasObj = nodePolyfillShimAliasObject(polyfillShimPaths)

  if (includeNodePolyfills && unresolvedPolyfillShims.length > 0) {
    console.warn(
      '[seed-vite-plugin] Could not resolve vite-plugin-node-polyfills shims from the SDK package:\n' +
        unresolvedPolyfillShims.map((id) => `  - ${id}`).join('\n') +
        '\nNode polyfill globals may fail to resolve. Reinstall @seedprotocol/sdk, or set includeNodePolyfills: false and configure polyfills yourself.',
    )
  } else if (unresolvedPolyfillShims.length === 0) {
    log('Resolved vite-plugin-node-polyfills shims to absolute paths')
  }

  /**
   * Pre-plugin: configure aliases and optimizeDeps.
   */
  const configPlugin: Plugin = {
    name: 'seed-protocol:config',
    enforce: 'pre',

    configResolved(resolvedConfig) {
      const addedAllowPaths = ensureDevServerFsAllow(resolvedConfig.server.fs.allow)
      if (addedAllowPaths.length > 0) {
        log(
          'Extended server.fs.allow for linked SDK / sqlocal worker paths:',
          addedAllowPaths,
        )
      }
    },

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

      addRendererCompatibilityAliases(aliasEntries)
      addNodePolyfillShimAliases(aliasEntries, polyfillShimPaths)

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
        ...FRAGILE_RENDERER_OPTIMIZE_INCLUDES,
      ]
      const resolvableOptimizeIncludes = desiredOptimizeIncludes.filter(
        (dep) => !!resolvePackageFile(dep, 'package.json'),
      )

      const existingOptimize = userConfig.optimizeDeps
      const debugOptimizeAliases = debugShimOptimizeAliasObject()

      const optimizeDeps: UserConfig['optimizeDeps'] = {
        ...omitDeprecatedOptimizeDepsKeys(existingOptimize),
        exclude: [
          ...(existingOptimize?.exclude ?? []),
          // Do not prebundle the SDK itself or clearly node-only tools
          '@seedprotocol/sdk',
          'drizzle-orm',
          'better-sqlite3',
          // sqlocal uses workers and should not be prebundled
          'sqlocal',
        ],
        include: [
          ...(existingOptimize?.include ?? []),
          ...resolvableOptimizeIncludes,
          ...EAS_OPTIMIZE_INCLUDES,
        ],
        // Keep `global` shim in optimizer Rolldown options; top-level Vite `define`
        // can be rejected by Rolldown in some consumer setups.
        rolldownOptions: mergeOptimizeDepsRolldownOptions(existingOptimize, {
          define: { global: 'globalThis' },
          alias: {
            ...debugOptimizeAliases,
            ...polyfillShimAliasObj,
          },
        }),
      }

      return {
        // Apply global → globalThis for Rollup production builds too.
        // optimizeDeps.rolldownOptions.transform.define only covers the dev pre-bundle step;
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
   * Runs after vite-plugin-node-polyfills so absolute shim aliases win over its bare
   * package-id aliases in both resolve.alias and the Rolldown optimizeDeps graph.
   */
  const polyfillResolvePlugin: Plugin = {
    name: 'seed-protocol:polyfill-resolve',
    enforce: 'post',

    config(userConfig) {
      if (Object.keys(polyfillShimAliasObj).length === 0) return

      const existingResolve = userConfig.resolve ?? {}
      const mergedAlias = withPreferredPolyfillAliases(
        normalizeAliasEntries(existingResolve.alias),
        polyfillShimPaths,
      )

      const existingOptimize = userConfig.optimizeDeps

      return {
        resolve: {
          ...existingResolve,
          alias: mergedAlias,
        },
        optimizeDeps: {
          rolldownOptions: mergeOptimizeDepsRolldownOptions(existingOptimize, {
            // Later merge overwrites bare shim ids from vite-plugin-node-polyfills.
            alias: polyfillShimAliasObj,
          }),
        },
      }
    },

    resolveId: {
      order: 'pre',
      handler(id) {
        // Always rewrite injected shim package ids (safe even if nested under the SDK).
        if (id === 'vite-plugin-node-polyfills/shims/buffer') {
          return polyfillShimPaths.buffer ?? null
        }
        if (id === 'vite-plugin-node-polyfills/shims/global') {
          return polyfillShimPaths.global ?? null
        }
        if (id === 'vite-plugin-node-polyfills/shims/process') {
          return polyfillShimPaths.process ?? null
        }
        // Only remap node globals when we own the polyfills plugin config.
        if (!includeNodePolyfills) return null
        if (id === 'buffer' || id === 'node:buffer') return polyfillShimPaths.buffer ?? null
        if (id === 'global') return polyfillShimPaths.global ?? null
        if (id === 'process' || id === 'node:process') return polyfillShimPaths.process ?? null
        return null
      },
    },

    transform: {
      // After polyfills banner/inject so we collapse duplicates left in optimized deps.
      // Must emit absolute shim paths: order "post" runs after import-analysis.
      order: 'post',
      handler(code) {
        const count = (code.match(/import\s+__buffer_polyfill\b/g) || []).length
        let next = code
        let mutated = false

        if (count > 1) {
          const deduped = dedupeNodePolyfillBanner(next, polyfillShimPaths)
          if (deduped) {
            next = deduped
            mutated = true
          }
        }

        const rewritten = rewriteBarePolyfillShimImports(next, polyfillShimPaths)
        if (rewritten) {
          next = rewritten
          mutated = true
        }

        if (mutated) return { code: next, map: null }
        return null
      },
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

      // Externalize Node.js-only packages that should never be bundled for the browser
      const nodeOnlyPackages = [
        'better-sqlite3', // Native SQLite binding (Node.js only)
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

  const sdkImportFixPlugin: Plugin = {
    name: 'seed-protocol:sdk-import-fix',
    enforce: 'post',
    transform(code, id) {
      if (!id.includes('@seedprotocol/sdk') || !id.includes('FileManager')) {
        return null
      }
      const hasDefaultPathBrowserifyImport =
        /import\s+path\s+from\s+['"]path-browserify['"]/.test(code)
      if (!hasDefaultPathBrowserifyImport) {
        return null
      }
      const transformed = code.replace(
        /import\s+path\s+from\s+['"]path-browserify['"];/g,
        "import * as path from 'path';",
      )
      if (transformed === code) {
        return null
      }
      return { code: transformed, map: null }
    },
  }

  const plugins: Plugin[] = [configPlugin, mainPlugin, sdkImportFixPlugin]

  if (includeNodePolyfills) {
    log('Including vite-plugin-node-polyfills with default settings')
    // vite-plugin-node-polyfills ≥0.27 returns Plugin[]; older versions returned a single Plugin.
    const polyfillPlugins = nodePolyfills({
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
    }) as unknown as Plugin | Plugin[]
    if (Array.isArray(polyfillPlugins)) {
      plugins.push(...polyfillPlugins)
    } else {
      plugins.push(polyfillPlugins)
    }
  }

  // After nodePolyfills so config() can overwrite its bare shim aliases.
  if (Object.keys(polyfillShimAliasObj).length > 0) {
    plugins.push(polyfillResolvePlugin)
  }

  return plugins
}
