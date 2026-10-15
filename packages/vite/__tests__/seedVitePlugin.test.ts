import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, resolveConfig } from 'vite'
import { seedVitePlugin } from '../src/index.js'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const vitePluginSrcDir = path.resolve(testDir, '../src')

function getConfigPlugin(options?: Parameters<typeof seedVitePlugin>[0]) {
  const plugins = seedVitePlugin({ includeNodePolyfills: false, ...options })
  const configPlugin = plugins.find((p) => p.name === 'seed-protocol:config')
  if (!configPlugin?.config) {
    throw new Error('seed-protocol:config plugin not found')
  }
  return configPlugin
}

function callConfig(
  plugin: { config?: unknown },
  userConfig: Record<string, unknown> = {},
  env: { command: 'serve' | 'build'; mode: string } = {
    command: 'serve',
    mode: 'development',
  },
) {
  const hook = plugin.config as
    | ((config: unknown, env: unknown) => unknown)
    | { handler: (config: unknown, env: unknown) => unknown }
    | undefined
  if (!hook) throw new Error('missing config hook')
  const fn = typeof hook === 'function' ? hook : hook.handler
  return fn(userConfig, env) as Record<string, any>
}

function getMainPlugin(options?: Parameters<typeof seedVitePlugin>[0]) {
  const plugins = seedVitePlugin({ includeNodePolyfills: false, ...options })
  const main = plugins.find((p) => p.name === 'seed-protocol:main')
  if (!main) throw new Error('seed-protocol:main plugin not found')
  return main
}

function aliasFindToString(find: string | RegExp): string {
  return typeof find === 'string' ? find : find.source
}

describe('seedVitePlugin renderer hardening', () => {
  it('exposes debug interop shim next to plugin sources', () => {
    const shimPath = path.join(vitePluginSrcDir, 'debug-default-shim.js')
    expect(fs.existsSync(shimPath)).toBe(true)
  })

  it('exposes stream stub shim next to plugin sources', () => {
    const shimPath = path.join(vitePluginSrcDir, 'stream-default-shim.js')
    expect(fs.existsSync(shimPath)).toBe(true)
  })

  it('merges renderer compatibility aliases and optimizeDeps includes', () => {
    const configPlugin = getConfigPlugin()
    const userConfig: Record<string, any> = { resolve: { alias: [] }, optimizeDeps: {} }
    const result = callConfig(configPlugin, userConfig)

    // Aliases are appended to the config in place (see the config hook), not returned.
    expect(result?.resolve?.alias).toBeUndefined()
    const aliases = userConfig.resolve.alias
    expect(Array.isArray(aliases)).toBe(true)

    const aliasKeys = (aliases as Array<{ find: string | RegExp; replacement: string }>).map(
      (a) => aliasFindToString(a.find),
    )

    expect(aliasKeys.some((k) => k.includes('nanoid-dictionary'))).toBe(true)
    expect(aliasKeys.some((k) => k === '^debug$')).toBe(true)
    expect(aliasKeys.some((k) => k === '^stream$')).toBe(true)
    expect(aliasKeys.some((k) => k === '^node:stream$')).toBe(true)

    const zenfsCoreIndex = path.join(
      process.cwd(),
      'node_modules/@zenfs/core/dist/index.js',
    )
    if (fs.existsSync(zenfsCoreIndex)) {
      expect(aliasKeys.some((k) => k.includes('@zenfs\\/core'))).toBe(true)
    }

    const includes = result?.optimizeDeps?.include ?? []
    expect(includes).toContain('debug')
    expect(includes).toContain('nanoid-dictionary')
    expect(includes).toContain('pluralize')
    expect(includes).toContain(
      '@seedprotocol/sdk > @ethereum-attestation-service/eas-sdk',
    )
    expect(includes).toContain(
      '@seedprotocol/sdk > @ethereum-attestation-service/eas-sdk > @ethereum-attestation-service/eas-contracts',
    )
  })

  it('uses optimizeDeps.rolldownOptions instead of deprecated esbuildOptions', () => {
    const configPlugin = getConfigPlugin()
    const result = configPlugin.config!({ resolve: { alias: [] }, optimizeDeps: {} })

    expect(result?.optimizeDeps?.esbuildOptions).toBeUndefined()
    expect(result?.optimizeDeps?.rollupOptions).toBeUndefined()
    expect(result?.optimizeDeps?.rolldownOptions?.transform?.define?.global).toBe('globalThis')
    expect(result?.optimizeDeps?.rolldownOptions?.resolve?.alias?.stream).toMatch(
      /stream-default-shim\.js$/,
    )
    expect(result?.optimizeDeps?.rolldownOptions?.resolve?.alias?.['node:stream']).toMatch(
      /stream-default-shim\.js$/,
    )
  })

  it('merges legacy optimizeDeps.esbuildOptions.define into rolldownOptions', () => {
    const configPlugin = getConfigPlugin()
    const result = callConfig(configPlugin, {
      resolve: { alias: [] },
      optimizeDeps: {
        esbuildOptions: { define: { 'process.env.FOO': '"bar"' } },
      },
    })

    expect(result?.optimizeDeps?.esbuildOptions).toBeUndefined()
    expect(result?.optimizeDeps?.rolldownOptions?.transform?.define).toMatchObject({
      'process.env.FOO': '"bar"',
      global: 'globalThis',
    })
  })

  it('prebundles app-optional deps only when the app root can resolve them', () => {
    const appOptional = ['kerium', 'utilium', 'memium', 'readable-stream', 'viem', 'isows']
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-root-'))
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-root-'))
    try {
      for (const dep of appOptional) {
        const pkgDir = path.join(appRoot, 'node_modules', dep)
        fs.mkdirSync(pkgDir, { recursive: true })
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: dep }))
      }
      const configPlugin = getConfigPlugin()

      const bare = callConfig(configPlugin, { root: bareRoot })
      for (const dep of appOptional) expect(bare.optimizeDeps.include).not.toContain(dep)

      const withDeps = callConfig(configPlugin, { root: appRoot })
      for (const dep of appOptional) expect(withDeps.optimizeDeps.include).toContain(dep)
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true })
      fs.rmSync(appRoot, { recursive: true, force: true })
    }
  })

  it('prebundles eas / arweave / query together and dedupes the ones the app resolves', () => {
    const shared = ['@seedprotocol/eas', '@seedprotocol/arweave', '@seedprotocol/query']
    const writePkg = (dir: string, name: string) => {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }))
    }
    const roots: string[] = []
    const mkRoot = () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-root-'))
      roots.push(root)
      return root
    }
    try {
      const configPlugin = getConfigPlugin()

      // Hoisted (npm): the app resolves each package.
      const hoisted = mkRoot()
      writePkg(path.join(hoisted, 'node_modules/@seedprotocol/sdk'), '@seedprotocol/sdk')
      for (const pkg of shared) writePkg(path.join(hoisted, 'node_modules', pkg), pkg)
      const h = callConfig(configPlugin, { root: hoisted })
      for (const pkg of shared) {
        expect(h.optimizeDeps.include).toContain(pkg)
        expect(h.resolve.dedupe).toContain(pkg)
      }

      // Nested under the SDK only (bun): prebundle through the SDK, never dedupe from the root.
      const nested = mkRoot()
      writePkg(path.join(nested, 'node_modules/@seedprotocol/sdk'), '@seedprotocol/sdk')
      const n = callConfig(configPlugin, { root: nested })
      for (const pkg of shared) {
        expect(n.optimizeDeps.include).toContain(`@seedprotocol/sdk > ${pkg}`)
        expect(n.resolve.dedupe).not.toContain(pkg)
      }

      // No SDK and no packages: nothing added.
      const bare = callConfig(configPlugin, { root: mkRoot() })
      for (const pkg of shared) {
        expect(bare.optimizeDeps.include.some((dep: string) => dep.endsWith(pkg))).toBe(false)
      }
    } finally {
      for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns only its own optimizeDeps additions (Vite concatenates arrays)', () => {
    const configPlugin = getConfigPlugin()
    const result = callConfig(configPlugin, {
      optimizeDeps: {
        include: ['user-include'],
        exclude: ['user-exclude'],
        rolldownOptions: { plugins: [{ name: 'user-optimizer-plugin' }] },
      },
    })
    expect(result.optimizeDeps.include).not.toContain('user-include')
    expect(result.optimizeDeps.exclude).not.toContain('user-exclude')
    expect(result.optimizeDeps.rolldownOptions.plugins).toBeUndefined()
  })

  it('includes sdk-import-fix post plugin', () => {
    const plugins = seedVitePlugin({ includeNodePolyfills: false })
    const fix = plugins.find((p) => p.name === 'seed-protocol:sdk-import-fix')
    expect(fix).toBeDefined()
    expect(fix?.enforce).toBe('post')
  })

  it('rewrites path-browserify default import in SDK FileManager chunks', () => {
    const plugins = seedVitePlugin({ includeNodePolyfills: false })
    const fix = plugins.find((p) => p.name === 'seed-protocol:sdk-import-fix')
    const code = "import path from 'path-browserify';\nexport { path }"
    const id = '/node_modules/@seedprotocol/sdk/dist/FileManager-abc.js'
    const out = fix?.transform?.(code, id)
    expect(out).not.toBeNull()
    expect(out?.code).toContain("import * as path from 'path'")
    expect(out?.code).not.toContain("from 'path-browserify'")
  })

  it('does not force NODE_ENV=production during vite serve', () => {
    const configPlugin = getConfigPlugin()
    const result = callConfig(
      configPlugin,
      { resolve: { alias: [] }, optimizeDeps: {} },
      { command: 'serve', mode: 'development' },
    )
    expect(result.define['process.env.NODE_ENV']).toBeUndefined()
  })

  it('does not overwrite a user NODE_ENV define', () => {
    const configPlugin = getConfigPlugin()
    const result = callConfig(
      configPlugin,
      {
        resolve: { alias: [] },
        optimizeDeps: {},
        define: { 'process.env.NODE_ENV': JSON.stringify('test') },
      },
      { command: 'serve', mode: 'development' },
    )
    expect(result.define['process.env.NODE_ENV']).toBe('"test"')
  })

  it('HTML process shim uses Vite mode instead of hardcoded production', () => {
    const plugins = seedVitePlugin({ includeNodePolyfills: false })
    const configPlugin = plugins.find((p) => p.name === 'seed-protocol:config')
    const main = plugins.find((p) => p.name === 'seed-protocol:main')
    callConfig(configPlugin!, {}, { command: 'serve', mode: 'development' })
    const hook = main?.transformIndexHtml
    const fn = typeof hook === 'function' ? hook : hook && 'handler' in hook ? hook.handler : null
    if (!fn) throw new Error('missing transformIndexHtml')
    const html = fn('<html><head></head></html>') as string
    expect(html).toContain("NODE_ENV:\"development\"")
    expect(html).not.toContain("NODE_ENV:'production'")
  })

  it('sets isolation headers on server config and writeHead', () => {
    const configPlugin = getConfigPlugin()
    const result = callConfig(configPlugin, { resolve: { alias: [] }, optimizeDeps: {} })
    expect(result.server?.headers?.['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(result.server?.headers?.['Cross-Origin-Embedder-Policy']).toBe('credentialless')
    expect(result.server?.headers?.['Cross-Origin-Resource-Policy']).toBe('same-origin')

    const main = getMainPlugin()
    const applied: Record<string, string> = {}
    const res = {
      getHeader: (key: string) => applied[key],
      setHeader: (key: string, value: string) => {
        applied[key] = value
      },
      writeHead: (...args: unknown[]) => args,
    }
    let middleware: ((req: unknown, res: unknown, next: () => void) => void) | undefined
    const server = {
      middlewares: {
        use: (fn: typeof middleware) => {
          middleware = fn
        },
      },
    }
    const hook = main.configureServer
    const fn = typeof hook === 'function' ? hook : hook && 'handler' in hook ? hook.handler : null
    if (!fn) throw new Error('missing configureServer')
    fn(server as any)
    expect(middleware).toBeDefined()
    middleware!({}, res, () => {})
    expect(applied['Cross-Origin-Opener-Policy']).toBe('same-origin')
    applied['Cross-Origin-Opener-Policy'] = ''
    res.writeHead(200, 'OK')
    expect(applied['Cross-Origin-Opener-Policy']).toBe('same-origin')
  })

  it('lets user server/preview isolation headers win over the plugin values', async () => {
    const plugins = seedVitePlugin({ includeNodePolyfills: false })
    const config = await resolveConfig(
      {
        root: testDir,
        configFile: false,
        logLevel: 'silent',
        plugins,
        server: {
          headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'X-App': 'dev' },
        },
        preview: { headers: { 'cross-origin-opener-policy': 'same-origin-allow-popups' } },
      },
      'serve',
    )
    expect(config.server.headers).toEqual({
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'X-App': 'dev',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
    // A lower-case user key is not shadowed by our capitalized one.
    expect(config.preview.headers).toEqual({
      'cross-origin-opener-policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })

    // The writeHead middleware sends the user's values too, not ours.
    const main = plugins.find((p) => p.name === 'seed-protocol:main')!
    for (const [hookName, expected] of [
      ['configureServer', { coep: 'require-corp', coop: 'same-origin' }],
      ['configurePreviewServer', { coep: 'credentialless', coop: 'same-origin-allow-popups' }],
    ] as const) {
      const applied: Record<string, string> = {}
      let middleware: ((req: unknown, res: unknown, next: () => void) => void) | undefined
      const hook = (main as Record<string, any>)[hookName]
      const fn = typeof hook === 'function' ? hook : hook.handler
      fn({ middlewares: { use: (m: typeof middleware) => { middleware = m } } })
      middleware!(
        {},
        {
          getHeader: (key: string) => applied[key],
          setHeader: (key: string, value: string) => { applied[key] = value },
          writeHead: () => {},
        },
        () => {},
      )
      expect(applied['Cross-Origin-Embedder-Policy']).toBe(expected.coep)
      expect(applied['Cross-Origin-Opener-Policy']).toBe(expected.coop)
    }
  })

  it('leaves preview inheriting server.headers when the user sets no preview headers', async () => {
    const config = await resolveConfig(
      {
        root: testDir,
        configFile: false,
        logLevel: 'silent',
        plugins: seedVitePlugin({ includeNodePolyfills: false }),
        server: { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'X-App': 'dev' } },
      },
      'serve',
    )
    expect(config.preview.headers).toEqual(config.server.headers)
    expect(config.preview.headers?.['X-App']).toBe('dev')
    expect(config.preview.headers?.['Cross-Origin-Embedder-Policy']).toBe('require-corp')
  })

  it('skips isolation headers when isolationHeaders is false', () => {
    const configPlugin = getConfigPlugin({ isolationHeaders: false })
    const result = callConfig(configPlugin, { resolve: { alias: [] }, optimizeDeps: {} })
    expect(result.server?.headers?.['Cross-Origin-Opener-Policy']).toBeUndefined()

    const main = getMainPlugin({ isolationHeaders: false })
    expect(main.configureServer).toBeDefined()
    let used = false
    fnSafeConfigure(main, {
      middlewares: { use: () => { used = true } },
    })
    expect(used).toBe(false)
  })
})

describe('seedVitePlugin resolved optimizer config (node polyfills on)', () => {
  async function resolveServeConfig(userConfig: Record<string, unknown> = {}) {
    return resolveConfig(
      {
        root: testDir,
        configFile: false,
        logLevel: 'silent',
        plugins: seedVitePlugin({ includeNodePolyfills: true }),
        ...userConfig,
      },
      'serve',
    )
  }

  it('registers the polyfills optimizer banner plugin exactly once', async () => {
    const config = await resolveServeConfig()
    const names = ((config.optimizeDeps.rolldownOptions?.plugins ?? []) as Array<{ name?: string }>)
      .flat()
      .map((p) => p?.name)
    expect(names.filter((n) => n === 'vite-plugin-node-polyfills:optimizer')).toHaveLength(1)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps user optimizer plugins and defines without duplicating them', async () => {
    const userPlugin = { name: 'user-optimizer-plugin' }
    const config = await resolveServeConfig({
      optimizeDeps: {
        rolldownOptions: {
          plugins: [userPlugin],
          transform: { define: { __USER_FLAG__: 'true' } },
        },
      },
    })
    const rolldownOptions = config.optimizeDeps.rolldownOptions!
    const names = ((rolldownOptions.plugins ?? []) as Array<{ name?: string }>)
      .flat()
      .map((p) => p?.name)
    expect(names.filter((n) => n === 'user-optimizer-plugin')).toHaveLength(1)
    expect(rolldownOptions.transform?.define).toMatchObject({ __USER_FLAG__: 'true' })
  })

  it('maps global to globalThis in the resolved optimizer define', async () => {
    const config = await resolveServeConfig()
    expect(config.optimizeDeps.rolldownOptions?.transform?.define?.global).toBe('globalThis')
  })
})

function fnSafeConfigure(plugin: { configureServer?: unknown }, server: unknown) {
  const hook = plugin.configureServer
  const fn = typeof hook === 'function' ? hook : hook && typeof hook === 'object' && 'handler' in hook ? (hook as { handler: Function }).handler : null
  fn?.(server)
}

describe('seedVitePlugin build options', () => {
  function captureWarnings() {
    const warnings: string[] = []
    const logger = createLogger('silent')
    logger.warn = (msg) => {
      warnings.push(msg)
    }
    logger.warnOnce = logger.warn
    return { logger, warnings }
  }

  async function resolveWith(command: 'serve' | 'build', userConfig: Record<string, unknown>) {
    const { logger, warnings } = captureWarnings()
    const config = await resolveConfig(
      {
        root: testDir,
        configFile: false,
        customLogger: logger,
        plugins: seedVitePlugin({ includeNodePolyfills: true }),
        ...userConfig,
      },
      command,
    )
    return { config, warnings }
  }

  for (const command of ['serve', 'build'] as const) {
    it(`keeps the user's build.rollupOptions without warning (${command})`, async () => {
      const userPlugin = { name: 'user-build-plugin' }
      const { config, warnings } = await resolveWith(command, {
        build: {
          rollupOptions: {
            output: { entryFileNames: 'app-[name].js' },
            external: ['user-ext'],
            plugins: [userPlugin],
          },
          commonjsOptions: { include: [/user-cjs/] },
        },
      })
      expect(warnings.filter((w) => /rollupOptions.*rolldownOptions/.test(w))).toEqual([])

      const options = config.build.rolldownOptions
      expect(config.build.rollupOptions).toBe(options)
      expect(options.output).toMatchObject({ entryFileNames: 'app-[name].js' })
      expect((options.plugins as unknown[]).filter((p) => p === userPlugin)).toHaveLength(1)

      const external = options.external as Array<string | RegExp>
      expect(external.filter((e) => e === 'user-ext')).toHaveLength(1)
      const isExternal = (id: string) =>
        external.some((e) => (typeof e === 'string' ? e === id : e.test(id)))
      expect(isExternal('better-sqlite3')).toBe(true)
      expect(isExternal('better-sqlite3/lib/index.js')).toBe(true)
      expect(isExternal('/app/node_modules/better-sqlite3/lib/index.js')).toBe(true)
      expect(isExternal('better-sqlite3-helper')).toBe(false)

      const cjsInclude = config.build.commonjsOptions.include as RegExp[]
      expect(cjsInclude.map(String)).toEqual([
        '/user-cjs/',
        '/node_modules/',
        String(/seed-protocol-sdk[\\/]+dist[\\/]/),
      ])
    })
  }

  it('wraps a user external function instead of replacing it', async () => {
    const { config } = await resolveWith('build', {
      build: { rolldownOptions: { external: (id: string) => id === 'user-ext' } },
    })
    const external = config.build.rolldownOptions.external as (
      id: string,
      importer: string | undefined,
      isResolved: boolean,
    ) => boolean
    expect(typeof external).toBe('function')
    expect(external('user-ext', undefined, false)).toBe(true)
    expect(external('better-sqlite3', undefined, false)).toBe(true)
    expect(external('react', undefined, false)).toBe(false)
  })

  it('defaults worker.format to es without overriding a user format', async () => {
    const { config: defaults } = await resolveWith('build', {})
    expect(defaults.worker.format).toBe('es')
    const { config: user } = await resolveWith('build', { worker: { format: 'iife' } })
    expect(user.worker.format).toBe('iife')
  })
})

describe('seedVitePlugin bare-globals scan', () => {
  function scan(code: string): string[] {
    const main = getMainPlugin()
    const hook = main.generateBundle as unknown as (o: unknown, b: unknown) => void
    const lines: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    try {
      hook.call({}, {}, { 'chunk.js': { type: 'chunk', code } })
    } finally {
      console.warn = warn
    }
    return lines
      .map((l) => /line (\d+): `(\w+)`/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => `${m[2]}@${m[1]}`)
  }

  it('reports free references to Node globals', () => {
    const code = [
      'export const env = process.env.API_URL',
      'export const buf = Buffer.from("x")',
      'export const dir = __dirname + __filename',
      'global.foo = 1',
      'if (typeof window !== "undefined") process.exit(1)',
    ].join('\n')
    expect(scan(code)).toEqual([
      'process@1',
      'Buffer@2',
      '__dirname@3',
      '__filename@3',
      'global@4',
      'process@5',
    ])
  })

  it.each([
    ['ternary typeof guard', 'export const a = typeof process === "object" ? process.env : {}'],
    [
      'if typeof guard',
      'if ("object" === typeof process && "function" === typeof process.emit) {\n' +
        '  process.emit("uncaughtException", new Error("x"))\n}',
    ],
    ['&& typeof guard', 'export const b = typeof Buffer !== "undefined" && Buffer.isBuffer(1)'],
    ['try block', 'try { process.cwd() } catch {}'],
    [
      'local var (process polyfill)',
      'var browser, process = (browser = {}); process.nextTick = () => {}',
    ],
    ['parameters', 'export function f(Buffer, { global }) { return Buffer.from(global) }'],
    ['object keys', 'export const o = { process: 1, global() {}, __dirname: 2 }'],
    ['member properties', 'export const m = window.process ?? window.Buffer'],
    ['class members', 'export class C { process = 1; global() {} }'],
    ['strings and comments', 'export const s = "process.env.X" // process.exit()'],
    ['template text', 'export const t = `Buffer.from(${1})`'],
  ])('ignores %s', (_label, code) => {
    expect(scan(code)).toEqual([])
  })

  it('reports nothing for a chunk it cannot parse', () => {
    expect(scan('process.env.X = (')).toEqual([])
  })
})
