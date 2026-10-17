import type { ConfigEnv, Plugin, PreviewServer, UserConfig, ViteDevServer } from 'vite'
import { parseAst } from 'vite'
import { attachScopes, type AttachedScope } from '@rollup/pluginutils'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import {
  DEFAULT_FS_MODULES,
  effectiveIsolationHeaders,
  isolationHeadersNotSetBy,
  resolveIsolationHeaders,
  zenfsModuleFor,
} from '@seedprotocol/bundler-core'

const _req = createRequire(import.meta.url)

export interface SeedVitePluginOptions {
  /**
   * Modules to alias to ZenFS (`@zenfs/core`, or `@zenfs/core/promises` for ids
   * containing "promises"). The list replaces the default; to add a module, pass
   * the defaults plus yours.
   * @default ['fs', 'fs/promises', 'node:fs', 'node:fs/promises']
   */
  fsModules?: string[]

  /**
   * Whether to inject a ZenFS initialization script into index.html that mounts
   * IndexedDB at `/`. Leave this false with the SDK: `client.init()` mounts OPFS
   * at `/` itself, so apps do not configure ZenFS, and this mount would only be
   * replaced. The script also imports the bare specifiers '@zenfs/core' and
   * '@zenfs/dom', which browsers cannot resolve without an import map.
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
   * Default include list omits full `stream`/`crypto` polyfills (those pull
   * stream-browserify and break Vite SSR / React Router prerender). A minimal
   * `stream` stub is still aliased so sax/rss-parser do not warn. Use `false`
   * for Framework Mode / prerender.
   * @default true
   */
  includeNodePolyfills?: boolean

  /**
   * Cross-origin isolation headers for sqlocal / SharedArrayBuffer / OPFS.
   * Applied in configureServer and configurePreviewServer, including writeHead,
   * because Vite `server.headers` is not copied onto Framework-Mode HTML responses.
   * Set `false` to disable. Pass `{ coop, coep, corp }` to override values.
   * A COOP/COEP/CORP value you set yourself in `server.headers` or `preview.headers`
   * (any letter case) wins over both this option and the defaults, for that server.
   * @default true (`COOP: same-origin`, `COEP: credentialless`, `CORP: same-origin`)
   */
  isolationHeaders?: boolean | {
    coop?: string
    coep?: string
    corp?: string
  }
}

// Node.js globals that are undefined in browsers and will throw at runtime.
const BROWSER_DANGEROUS_GLOBALS = new Set(['global', 'process', 'Buffer', '__dirname', '__filename'])

interface GlobalHit {
  global: string
  /** zero-based character offset in the chunk */
  offset: number
  /** 1-based line number */
  line: number
  /** surrounding raw source for context */
  context: string
}

// Loose ESTree node: we only read type, positions and child nodes.
type AstNode = { type: string; start: number; end: number; [key: string]: unknown }
type AstPath = { node: AstNode; key: string; parent: AstPath | null }

function isAstNode(value: unknown): value is AstNode {
  return !!value && typeof value === 'object' && typeof (value as AstNode).type === 'string'
}

/** Whether an Identifier at `key` of `parent` reads a variable (not a property name or label). */
function isVariableReference(parent: AstNode, key: string): boolean {
  switch (parent.type) {
    case 'MemberExpression':
      return key !== 'property' || !!parent.computed
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
      return key !== 'key' || !!parent.computed
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
      return false
    case 'ImportSpecifier':
      return key !== 'imported'
    case 'ExportSpecifier':
      return key !== 'exported'
    default:
      return true
  }
}

function containsTypeofOf(node: AstNode, name: string): boolean {
  if (
    node.type === 'UnaryExpression' &&
    node.operator === 'typeof' &&
    isAstNode(node.argument) &&
    node.argument.type === 'Identifier' &&
    node.argument.name === name
  ) {
    return true
  }
  for (const key of Object.keys(node)) {
    const child = node[key]
    if (Array.isArray(child)) {
      if (child.some((c) => isAstNode(c) && containsTypeofOf(c, name))) return true
    } else if (isAstNode(child) && containsTypeofOf(child, name)) {
      return true
    }
  }
  return false
}

/**
 * Whether the reference only runs behind a guard: the consequent of a
 * `typeof name` test (`if`, `?:`, `&&`/`||`), or a try block.
 */
function isGuarded(path: AstPath, name: string): boolean {
  for (let child = path; child.parent; child = child.parent) {
    const ancestor = child.parent.node
    const viaKey = child.key
    if (
      (ancestor.type === 'IfStatement' || ancestor.type === 'ConditionalExpression') &&
      viaKey !== 'test' &&
      containsTypeofOf(ancestor.test as AstNode, name)
    ) {
      return true
    }
    if (
      ancestor.type === 'LogicalExpression' &&
      viaKey === 'right' &&
      containsTypeofOf(ancestor.left as AstNode, name)
    ) {
      return true
    }
    if (ancestor.type === 'TryStatement' && viaKey === 'block') return true
  }
  return false
}

/**
 * Find free references to Node-only globals in a bundled chunk. Skips names
 * the chunk declares itself (e.g. the process polyfill's own `var process`),
 * `typeof` checks, property names, and uses behind a `typeof` guard or `try`.
 * Best-effort: a chunk that fails to parse reports nothing.
 */
function findDangerousGlobals(code: string): GlobalHit[] {
  let program: AstNode
  let rootScope: AttachedScope
  try {
    program = parseAst(code) as unknown as AstNode
    rootScope = attachScopes(program as never, 'scope')
  } catch {
    return []
  }

  const hits: GlobalHit[] = []
  const lineStarts = [0]
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const lineIndexOf = (offset: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  // Iterative walk: bundled chunks can nest deeper than the call stack allows.
  const stack: Array<{ path: AstPath; scope: AttachedScope }> = [
    { path: { node: program, key: '', parent: null }, scope: rootScope },
  ]
  while (stack.length > 0) {
    const { path, scope: outerScope } = stack.pop()!
    const { node } = path
    const scope = (node.scope as AttachedScope | undefined) ?? outerScope

    if (
      node.type === 'Identifier' &&
      BROWSER_DANGEROUS_GLOBALS.has(node.name as string) &&
      path.parent
    ) {
      const name = node.name as string
      const parent = path.parent.node
      const isTypeofOperand = parent.type === 'UnaryExpression' && parent.operator === 'typeof'
      if (
        !isTypeofOperand &&
        isVariableReference(parent, path.key) &&
        !scope.contains(name) &&
        !isGuarded(path, name)
      ) {
        const lineIndex = lineIndexOf(node.start)
        const lineStart = lineStarts[lineIndex]!
        const lineEnd = lineStarts[lineIndex + 1] ?? code.length
        const context = code
          .slice(Math.max(lineStart, node.start - 40), Math.min(lineEnd, node.end + 40))
          .trim()
        hits.push({ global: name, offset: node.start, line: lineIndex + 1, context })
      }
      continue
    }

    const children: AstPath[] = []
    for (const key of Object.keys(node)) {
      if (key === 'scope') continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) children.push({ node: item, key, parent: path })
        }
      } else if (isAstNode(value)) {
        children.push({ node: value, key, parent: path })
      }
    }
    // Reverse so hits come out in source order.
    for (let i = children.length - 1; i >= 0; i--) stack.push({ path: children[i]!, scope })
  }

  return hits
}

const SDK_DIST_DIR = path.dirname(fileURLToPath(import.meta.url))
const ARWEAVE_SHIM_FILE = path.join(SDK_DIST_DIR, 'arweave-default-shim.js')
const DEBUG_SHIM_FILE = path.join(SDK_DIST_DIR, 'debug-default-shim.js')
const STREAM_SHIM_FILE = path.join(SDK_DIST_DIR, 'stream-default-shim.js')

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

/**
 * Prebundled only when the app itself can resolve them. Vite resolves `include`
 * entries from the app root, so finding them under a linked SDK is not enough
 * (Vite would skip them with "Failed to resolve dependency"). The zenfs helpers
 * are bundled into the @zenfs chunks anyway; viem/isows come from
 * @seedprotocol/publish, not the SDK.
 */
const APP_OPTIONAL_OPTIMIZE_INCLUDES = [
  'kerium',
  'utilium',
  'memium',
  'readable-stream',
  'viem',
  'isows',
] as const

/**
 * Seed packages whose module-level state (registered EAS / query / Arweave clients, EAS chain,
 * Arweave gateway) must be one copy per page. With the SDK excluded from prebundling, Vite can
 * find these one at a time; a package prebundled in a later optimizer pass can load as its own
 * module instance, and query then throws DuplicateEasModuleError. Prebundling them together in
 * the first pass, and deduping the ones the app resolves, keeps one copy.
 */
const SEED_SHARED_STATE_PACKAGES = [
  '@seedprotocol/eas',
  '@seedprotocol/arweave',
  '@seedprotocol/query',
] as const

/**
 * `include` entries: the bare name when the app resolves the package itself, else the nested
 * form through the SDK (bun installs it under @seedprotocol/sdk). `dedupe` only gets packages
 * the app root resolves: Vite resolves deduped packages from the root, so a nested-only one
 * would fail to resolve.
 */
function seedSharedStateDeps(appRoot: string): { include: string[]; dedupe: string[] } {
  const include: string[] = []
  const dedupe: string[] = []
  const sdkAtRoot = isResolvableFromRoot('@seedprotocol/sdk', appRoot)
  for (const pkg of SEED_SHARED_STATE_PACKAGES) {
    if (isResolvableFromRoot(pkg, appRoot)) {
      include.push(pkg)
      dedupe.push(pkg)
    } else if (sdkAtRoot) {
      include.push(`@seedprotocol/sdk > ${pkg}`)
    }
  }
  return { include, dedupe }
}

/**
 * CJS packages Seed ESM default-imports. Always included: without pre-bundling, the browser
 * gets raw CJS and the SDK's default import fails.
 */
const CJS_OPTIMIZE_INCLUDES = ['pluralize'] as const

/**
 * The bare name when the app resolves the package, else the nested form through the SDK
 * (pnpm keeps SDK dependencies out of the app's node_modules).
 */
function cjsOptimizeIncludes(appRoot: string): string[] {
  const sdkAtRoot = isResolvableFromRoot('@seedprotocol/sdk', appRoot)
  return CJS_OPTIMIZE_INCLUDES.map((pkg) =>
    sdkAtRoot && !isResolvableFromRoot(pkg, appRoot) ? `@seedprotocol/sdk > ${pkg}` : pkg,
  )
}

function applyIsolationHeaderMiddleware(
  server: ViteDevServer | PreviewServer,
  headers: Record<string, string>,
): void {
  server.middlewares.use((_req, res, next) => {
    const apply = () => {
      for (const [key, value] of Object.entries(headers)) {
        if (!res.getHeader(key)) {
          res.setHeader(key, value)
        }
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

/**
 * Whether a package is installed where Vite's optimizer looks for it: the node_modules folders
 * from the app root upward. Not `require.resolve.paths()`, which adds NODE_PATH; pnpm's bin
 * shims set that to node_modules/.pnpm/node_modules, which Vite doesn't search.
 */
function isResolvableFromRoot(packageName: string, root: string): boolean {
  let dir = path.resolve(root)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', packageName, 'package.json'))) return true
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
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

  // Minimal stream stub (not stream-browserify) so sax/rss-parser init is quiet.
  if (fs.existsSync(STREAM_SHIM_FILE)) {
    aliasEntries.push(
      { find: /^stream$/, replacement: STREAM_SHIM_FILE },
      { find: /^node:stream$/, replacement: STREAM_SHIM_FILE },
    )
  }
}

/** Object-form aliases for optimizeDeps pre-bundle (debug shim subpath). */
function debugShimOptimizeAliasObject(): Record<string, string> {
  const debugBrowserEntry = resolvePackageFile('debug', 'src/browser.js')
  return debugBrowserEntry ? { 'debug/src/browser.js': debugBrowserEntry } : {}
}

/** Object-form aliases so optimizeDeps prebundles (rss-parser → sax) use our stream stub. */
function streamShimOptimizeAliasObject(): Record<string, string> {
  if (!fs.existsSync(STREAM_SHIM_FILE)) return {}
  return {
    stream: STREAM_SHIM_FILE,
    'node:stream': STREAM_SHIM_FILE,
  }
}

type OptimizeDepsConfig = NonNullable<UserConfig['optimizeDeps']>

/**
 * Build a Vite 8 `optimizeDeps.rolldownOptions` patch for a plugin `config()` hook.
 *
 * Returns only what this plugin adds. Vite deep-merges hook results into the
 * user config and concatenates arrays, so echoing existing options back would
 * duplicate them — e.g. vite-plugin-node-polyfills' optimizer banner plugin,
 * which then declares `__buffer_polyfill` twice in every prebundled chunk.
 * Legacy `esbuildOptions.define` is carried into `transform.define` so
 * definitions survive the move off the deprecated key.
 */
function optimizeDepsRolldownPatch(
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
 * Minimal Vite plugin to make the SDK work in browser/Electron renderer:
 * - Aliases fs → @zenfs/core (and promises variant)
 * - Aliases path → path-browserify
 * - Ensures CommonJS in SDK dist is transformed by Vite's CommonJS plugin
 * - Allowlists linked SDK / sqlocal worker paths on server.fs.allow for Vite dev
 * - Optionally wires up vite-plugin-node-polyfills with safe defaults
 *
 * This plugin assumes the SDK does not bundle Node-only code in the browser entry.
 * For Electron, Node-only work (e.g. better-sqlite3) should run in the
 * main process; the renderer should only use browser-safe SDK usage.
 *
 * For the renderer build:
 * - Use the SDK's ESM entry: import from '@seedprotocol/sdk' (resolves to dist/main.js).
 * - Do not configure ZenFS yourself: `client.init()` mounts OPFS at `/`.
 */
export function seedVitePlugin(options: SeedVitePluginOptions = {}): Plugin[] {
  const {
    fsModules = [...DEFAULT_FS_MODULES],
    autoInit = false,
    debug = false,
    includeNodePolyfills = true,
    isolationHeaders: isolationHeadersOption,
  } = options

  const isolationHeaders = resolveIsolationHeaders(isolationHeadersOption)
  // Replaced in configResolved by the values the user's server/preview headers leave us.
  let serverIsolationHeaders = isolationHeaders
  let previewIsolationHeaders = isolationHeaders
  let htmlNodeEnv = 'production'

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
      if (isolationHeaders) {
        serverIsolationHeaders = effectiveIsolationHeaders(
          isolationHeaders,
          resolvedConfig.server.headers,
        )
        previewIsolationHeaders = effectiveIsolationHeaders(
          isolationHeaders,
          resolvedConfig.preview.headers,
        )
      }
      const addedAllowPaths = ensureDevServerFsAllow(resolvedConfig.server.fs.allow)
      if (addedAllowPaths.length > 0) {
        log(
          'Extended server.fs.allow for linked SDK / sqlocal worker paths:',
          addedAllowPaths,
        )
      }
    },

    config(userConfig, env) {
      if (env?.mode) {
        htmlNodeEnv = env.mode
      }
      const aliasEntries: AliasEntry[] = []
      for (const mod of fsModules) {
        aliasEntries.push({ find: mod, replacement: zenfsModuleFor(mod) })
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
      // Node polyfill shim aliases come from seed-protocol:polyfill-resolve, ahead of all others.

      // Vite merges a returned alias list *before* the existing one, so returning ours
      // would let it shadow the user's. Append to the config in place instead (Vite's
      // documented escape hatch when merging can't express the order), skipping finds
      // the user already set, so user aliases still match first.
      userConfig.resolve = {
        ...userConfig.resolve,
        alias: mergeAliasEntries(normalizeAliasEntries(userConfig.resolve?.alias), aliasEntries),
      }
      const userDedupe = new Set(userConfig.resolve.dedupe ?? [])

      const desiredOptimizeIncludes = [
        '@zenfs/core',
        '@zenfs/dom',
        ...FRAGILE_RENDERER_OPTIMIZE_INCLUDES,
      ]
      const appRoot = path.resolve(userConfig.root ?? process.cwd())
      const resolvableOptimizeIncludes = [
        ...desiredOptimizeIncludes.filter((dep) => !!resolvePackageFile(dep, 'package.json')),
        ...APP_OPTIONAL_OPTIMIZE_INCLUDES.filter((dep) => isResolvableFromRoot(dep, appRoot)),
      ]

      const sharedStateDeps = seedSharedStateDeps(appRoot)

      const existingOptimize = userConfig.optimizeDeps
      const debugOptimizeAliases = debugShimOptimizeAliasObject()
      const streamOptimizeAliases = streamShimOptimizeAliasObject()

      // Only this plugin's additions: Vite concatenates them onto the user's arrays.
      const optimizeDeps: UserConfig['optimizeDeps'] = {
        exclude: [
          // Do not prebundle the SDK itself or clearly node-only tools
          '@seedprotocol/sdk',
          'drizzle-orm',
          'better-sqlite3',
          // sqlocal uses workers and should not be prebundled
          'sqlocal',
        ],
        include: [
          ...resolvableOptimizeIncludes,
          ...sharedStateDeps.include,
          ...EAS_OPTIMIZE_INCLUDES,
          ...cjsOptimizeIncludes(appRoot),
        ],
        // Keep `global` shim in optimizer Rolldown options; top-level Vite `define`
        // can be rejected by Rolldown in some consumer setups.
        rolldownOptions: optimizeDepsRolldownPatch(existingOptimize, {
          define: { global: 'globalThis' },
          alias: {
            ...debugOptimizeAliases,
            ...streamOptimizeAliases,
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
          // process is referenced by path-browserify and other CJS modules.
          // Point at globalThis.process which is set by the synchronous inline
          // shim script injected into index.html before any modules load.
          // Do not define process.env.NODE_ENV — Vite already sets it from mode,
          // and forcing "production" during `vite serve` compiles out React Refresh.
          'process.browser': 'true',
          'process.platform': '"browser"',
        },
        // Only this plugin's dedupe entries: Vite concatenates them onto the user's.
        resolve: {
          // Prevent duplicate React/thirdweb instances when @seedprotocol/publish is workspace-linked.
          // Multiple copies break context (e.g. useActiveAccount must be used within ThirdwebProvider).
          // Also dedupe XState and Seed packages: two xstate copies cause Object.assign _version errors;
          // two @seedprotocol/sdk copies leave BaseDb facade / Db.appDb on different module instances
          // ("App DB not found", undefined.$with on PostsPage).
          // Two eas / arweave / query copies split registered clients and chain (see SEED_SHARED_STATE_PACKAGES).
          // Two @zenfs copies leave configureSingle / WebAccess on different module instances
          // and can remount OPFS against a stale handle.
          dedupe: Array.from(
            new Set([
              'react',
              'react-dom',
              'thirdweb',
              'xstate',
              '@xstate/react',
              '@seedprotocol/sdk',
              '@seedprotocol/react',
              '@seedprotocol/publish',
              '@seedprotocol/feed',
              ...sharedStateDeps.dedupe,
              '@zenfs/core',
              '@zenfs/dom',
            ]),
          ).filter((dep) => !userDedupe.has(dep)),
        },
        optimizeDeps,
        // Only the headers the user has not set: Vite deep-merges these into theirs.
        // Preview falls back to server.headers when preview.headers is unset, so
        // only touch preview.headers when the user set it.
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

      // Rewrite resolve.alias in place rather than returning it: this drops entries
      // (a returned list can only add), and Vite would concatenate a returned copy
      // onto the existing list, duplicating every alias.
      userConfig.resolve = {
        ...userConfig.resolve,
        alias: withPreferredPolyfillAliases(
          normalizeAliasEntries(userConfig.resolve?.alias),
          polyfillShimPaths,
        ),
      }

      return {
        optimizeDeps: {
          rolldownOptions: optimizeDepsRolldownPatch(undefined, {
            // Later merges overwrite vite-plugin-node-polyfills' serve-time
            // `global: 'global'` define and its bare shim-id aliases.
            define: { global: 'globalThis' },
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
      // Must emit absolute shim paths: order "post" runs after import-analysis.
      order: 'post',
      handler(code) {
        const rewritten = rewriteBarePolyfillShimImports(code, polyfillShimPaths)
        return rewritten ? { code: rewritten, map: null } : null
      },
    },
  }

  /**
   * Post-plugin: build configuration + optional ZenFS init.
   */
  const mainPlugin: Plugin = {
    name: 'seed-protocol:main',
    enforce: 'post',

    configureServer(server) {
      if (serverIsolationHeaders) applyIsolationHeaderMiddleware(server, serverIsolationHeaders)
    },

    configurePreviewServer(server) {
      if (previewIsolationHeaders) applyIsolationHeaderMiddleware(server, previewIsolationHeaders)
    },

    config(userConfig) {
      // Only this plugin's additions: Vite deep-merges them into the user's build
      // config and concatenates arrays. Echoing `...userConfig.build` back also
      // returned both `rollupOptions` and `rolldownOptions` (Vite 8 aliases one
      // to the other), which made Vite warn on every run.
      const commonjsOptions = {
        // Always process node_modules and the SDK dist so require() is transformed
        include: [/node_modules/, /seed-protocol-sdk[\\/]+dist[\\/]/],
        // sqlocal is ESM and uses workers - don't transform it
        exclude: [/node_modules[\\/]+sqlocal[\\/]/],
        transformMixedEsModules: true,
      }

      // Externalize Node.js-only packages that should never be bundled for the browser
      // (better-sqlite3: native SQLite binding, Node.js only), by bare id or resolved path.
      const nodeOnlyExternal = [/^better-sqlite3(?:\/|$)/, /[\\/]better-sqlite3(?:[\\/]|$)/]
      const userExternal = (userConfig.build?.rolldownOptions ?? userConfig.build?.rollupOptions)
        ?.external
      // A user external function can't be concatenated with patterns, so wrap it.
      // Otherwise return patterns, which Vite appends to the user's list.
      const external =
        typeof userExternal === 'function'
          ? (id: string, importer: string | undefined, isResolved: boolean) =>
              nodeOnlyExternal.some((re) => re.test(id)) || userExternal(id, importer, isResolved)
          : nodeOnlyExternal

      // Worker options are TOP-LEVEL in Vite config, not under build.
      // Default 'iife' breaks when workers use code-splitting (e.g. sqlocal).
      return {
        build: {
          commonjsOptions,
          rolldownOptions: { external },
        },
        ...(userConfig.worker?.format ? {} : { worker: { format: 'es' as const } }),
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
      const nodeEnvLiteral = JSON.stringify(htmlNodeEnv)
      const shimScript = `<script>
(function(){
  if(typeof globalThis.global==='undefined')globalThis.global=globalThis;
  if(typeof globalThis.process==='undefined')globalThis.process={env:{NODE_ENV:${nodeEnvLiteral}},browser:true,version:'v18.0.0',versions:{},platform:'browser',cwd:function(){return'/'},nextTick:function(fn){setTimeout(fn,0)}};
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
      include: ['path', 'buffer', 'events', 'string_decoder', 'util'],
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
