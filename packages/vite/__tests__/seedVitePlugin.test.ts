import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger, resolveConfig, type Plugin } from 'vite'
import { seedVitePlugin, type SeedVitePluginOptions } from '../src/index.js'

const testDir = path.dirname(fileURLToPath(import.meta.url))

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** A temp dir with real path (macOS temp dirs are symlinks). */
function tempDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-')))
  tempDirs.push(dir)
  return dir
}

function writePackage(dir: string, name: string, extra: Record<string, unknown> = {}): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, ...extra }))
}

function configPlugin(options?: SeedVitePluginOptions): Plugin {
  const plugin = seedVitePlugin(options).find((p) => p.name === 'seed-protocol:config')
  if (!plugin) throw new Error('seed-protocol:config plugin not found')
  return plugin
}

function hookFn(plugin: Plugin, name: keyof Plugin): (...args: any[]) => any {
  const hook = (plugin as Record<string, any>)[name]
  const fn = typeof hook === 'function' ? hook : hook?.handler
  if (!fn) throw new Error(`missing ${String(name)} hook`)
  return fn
}

function callConfig(plugin: Plugin, userConfig: Record<string, any> = {}, mode = 'development') {
  return hookFn(plugin, 'config')(userConfig, { command: 'serve', mode }) as Record<string, any>
}

async function resolveWith(
  command: 'serve' | 'build',
  options: SeedVitePluginOptions,
  userConfig: Record<string, unknown> = {},
) {
  const warnings: string[] = []
  const logger = createLogger('silent')
  logger.warn = (msg) => {
    warnings.push(msg)
  }
  logger.warnOnce = logger.warn
  const config = await resolveConfig(
    { root: testDir, configFile: false, customLogger: logger, plugins: seedVitePlugin(options), ...userConfig },
    command,
  )
  return { config, warnings }
}

/** Run a configure(Preview)Server hook and return the headers its middleware sets. */
function middlewareHeaders(
  plugin: Plugin,
  hookName: 'configureServer' | 'configurePreviewServer',
): Record<string, string> | undefined {
  let middleware: ((req: unknown, res: unknown, next: () => void) => void) | undefined
  hookFn(plugin, hookName)({ middlewares: { use: (m: typeof middleware) => { middleware = m } } })
  if (!middleware) return undefined
  const applied: Record<string, string> = {}
  const res = {
    getHeader: (key: string) => applied[key],
    setHeader: (key: string, value: string) => {
      applied[key] = value
    },
    writeHead: () => {},
  }
  middleware({}, res, () => {})
  // writeHead re-applies headers a handler cleared (React Router Framework Mode).
  delete applied['Cross-Origin-Opener-Policy']
  res.writeHead()
  return applied
}

describe('seedVitePlugin defaults', () => {
  it('is one plugin that adds no aliases, pre-bundling lists, defines or HTML', () => {
    const plugins = seedVitePlugin()
    expect(plugins.map((p) => p.name)).toEqual(['seed-protocol:config'])

    const userConfig: Record<string, any> = {}
    const result = callConfig(plugins[0]!, userConfig)
    expect(userConfig.resolve).toBeUndefined()
    expect(result.optimizeDeps).toEqual({ rolldownOptions: { output: { strictExecutionOrder: true } } })
    expect(result.define).toBeUndefined()
    expect(result.build).toBeUndefined()
    expect(plugins[0]!.transformIndexHtml).toBeUndefined()
  })

  it('runs dev pre-bundle chunks in order unless the user decides', async () => {
    for (const includeNodePolyfills of [false, true]) {
      const { config } = await resolveWith('serve', { includeNodePolyfills })
      expect(config.optimizeDeps.rolldownOptions?.output).toMatchObject({ strictExecutionOrder: true })
    }
    const { config: user } = await resolveWith('serve', {}, {
      optimizeDeps: { rolldownOptions: { output: { strictExecutionOrder: false } } },
    })
    expect(user.optimizeDeps.rolldownOptions?.output).toMatchObject({ strictExecutionOrder: false })
  })

  it('defaults worker.format to es without overriding a user format', async () => {
    const { config: defaults } = await resolveWith('build', {})
    expect(defaults.worker.format).toBe('es')
    const { config: user } = await resolveWith('build', {}, { worker: { format: 'iife' } })
    expect(user.worker.format).toBe('iife')
  })

  for (const command of ['serve', 'build'] as const) {
    it(`leaves the user's build options alone and doesn't warn (${command})`, async () => {
      const userPlugin = { name: 'user-build-plugin' }
      const { config, warnings } = await resolveWith(command, { includeNodePolyfills: true }, {
        build: {
          rollupOptions: {
            output: { entryFileNames: 'app-[name].js' },
            external: ['user-ext'],
            plugins: [userPlugin],
          },
        },
      })
      expect(warnings.filter((w) => /rollupOptions.*rolldownOptions/.test(w))).toEqual([])
      const options = config.build.rolldownOptions
      expect(options.output).toMatchObject({ entryFileNames: 'app-[name].js' })
      expect(options.external).toEqual(['user-ext'])
      expect((options.plugins as unknown[]).filter((p) => p === userPlugin)).toHaveLength(1)
    })
  }
})

describe('seedVitePlugin isolation headers', () => {
  it('sets them on the server config and in writeHead', () => {
    const plugin = configPlugin()
    const result = callConfig(plugin)
    expect(result.server.headers).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
    expect(middlewareHeaders(plugin, 'configureServer')).toEqual(result.server.headers)
  })

  it('lets user server/preview headers win over the plugin values', async () => {
    const options = {}
    const { config } = await resolveWith('serve', options, {
      server: { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'X-App': 'dev' } },
      preview: { headers: { 'cross-origin-opener-policy': 'same-origin-allow-popups' } },
    })
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
    const plugin = config.plugins.find((p) => p.name === 'seed-protocol:config')!
    expect(middlewareHeaders(plugin, 'configureServer')).toMatchObject({
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    expect(middlewareHeaders(plugin, 'configurePreviewServer')).toMatchObject({
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    })
  })

  it('leaves preview inheriting server.headers when the user sets no preview headers', async () => {
    const { config } = await resolveWith('serve', {}, {
      server: { headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'X-App': 'dev' } },
    })
    expect(config.preview.headers).toEqual(config.server.headers)
    expect(config.preview.headers?.['Cross-Origin-Embedder-Policy']).toBe('require-corp')
  })

  it('takes overrides, and sets nothing when isolationHeaders is false', () => {
    expect(callConfig(configPlugin({ isolationHeaders: { coep: 'require-corp' } })).server.headers).toMatchObject({
      'Cross-Origin-Embedder-Policy': 'require-corp',
    })

    const off = configPlugin({ isolationHeaders: false })
    expect(callConfig(off).server).toBeUndefined()
    expect(middlewareHeaders(off, 'configureServer')).toBeUndefined()
  })
})

describe('seedVitePlugin installs outside the app root', () => {
  it('dedupes the packages the app root resolves, and only those', () => {
    const hoisted = tempDir()
    for (const pkg of ['react', 'react-dom', '@seedprotocol/sdk', '@seedprotocol/eas']) {
      writePackage(path.join(hoisted, 'node_modules', pkg), pkg)
    }
    expect(callConfig(configPlugin(), { root: hoisted }).resolve.dedupe).toEqual([
      'react',
      'react-dom',
      '@seedprotocol/sdk',
      '@seedprotocol/eas',
    ])

    // Nested under the SDK only (pnpm, bun): Vite would fail to resolve it from the root.
    const nested = tempDir()
    writePackage(path.join(nested, 'node_modules/@seedprotocol/sdk'), '@seedprotocol/sdk')
    writePackage(path.join(nested, 'node_modules/@seedprotocol/sdk/node_modules/@seedprotocol/eas'), '@seedprotocol/eas')
    expect(callConfig(configPlugin(), { root: nested }).resolve.dedupe).toEqual(['@seedprotocol/sdk'])
  })

  it('keeps user dedupe entries once', async () => {
    const root = tempDir()
    writePackage(path.join(root, 'node_modules/react'), 'react')
    const { config } = await resolveWith('serve', {}, { root, resolve: { dedupe: ['user-dep', 'react'] } })
    expect(config.resolve.dedupe.filter((dep) => dep === 'react')).toHaveLength(1)
    expect(config.resolve.dedupe).toContain('user-dep')
  })

  it('lets the dev server read a linked SDK and its SQLite worker', async () => {
    // The SDK and its dependencies live outside the app, as with `file:` or `link:` installs.
    const checkout = tempDir()
    const sdkDir = path.join(checkout, 'packages/sdk')
    writePackage(sdkDir, '@seedprotocol/sdk')
    // Like sqlocal: ESM-only, no package.json export, so require.resolve can't find it.
    writePackage(path.join(checkout, 'node_modules/sqlocal'), 'sqlocal', {
      exports: { '.': { import: './dist/index.js' } },
    })
    writePackage(path.join(checkout, 'node_modules/@sqlite.org/sqlite-wasm'), '@sqlite.org/sqlite-wasm')

    const app = tempDir()
    writePackage(app, 'app')
    fs.mkdirSync(path.join(app, 'node_modules/@seedprotocol'), { recursive: true })
    fs.symlinkSync(sdkDir, path.join(app, 'node_modules/@seedprotocol/sdk'))

    const { config } = await resolveWith('serve', {}, { root: app })
    expect(config.server.fs.allow).toEqual(
      expect.arrayContaining([
        sdkDir,
        path.join(checkout, 'node_modules/sqlocal'),
        path.join(checkout, 'node_modules/@sqlite.org/sqlite-wasm'),
      ]),
    )

    // An SDK installed inside the app is already allowed.
    const local = tempDir()
    writePackage(path.join(local, 'node_modules/@seedprotocol/sdk'), '@seedprotocol/sdk')
    const { config: localConfig } = await resolveWith('serve', {}, { root: local })
    expect(localConfig.server.fs.allow.filter((dir) => dir.includes('@seedprotocol'))).toEqual([])
  })
})

describe('seedVitePlugin fsModules', () => {
  it('aliases the listed modules to ZenFS after the user aliases', async () => {
    for (const alias of [
      [{ find: 'fs', replacement: '/user/fs.js' }, { find: 'user-lib', replacement: '/user/lib.js' }],
      { fs: '/user/fs.js', 'user-lib': '/user/lib.js' },
    ]) {
      const { config } = await resolveWith(
        'serve',
        { fsModules: ['fs', 'node:fs/promises'] },
        { resolve: { alias } },
      )
      const entries = config.resolve.alias.map((entry) => [String(entry.find), entry.replacement])
      expect(entries.filter(([find]) => find === 'fs')).toEqual([['fs', '/user/fs.js']])
      expect(entries).toContainEqual(['node:fs/promises', '@zenfs/core/promises'])
      expect(entries.findIndex(([find]) => find === 'user-lib')).toBeLessThan(
        entries.findIndex(([find]) => find === 'node:fs/promises'),
      )
    }
  })
})

describe('seedVitePlugin includeNodePolyfills', () => {
  const resolvePolyfilled = (userConfig: Record<string, unknown> = {}) =>
    resolveWith('serve', { includeNodePolyfills: true }, userConfig).then((r) => r.config)

  it('adds the polyfills and resolves their shims to this package', async () => {
    const config = await resolvePolyfilled({
      resolve: { alias: [{ find: 'user-lib', replacement: '/user/lib.js' }] },
    })
    const names = config.plugins.map((p) => p.name)
    expect(names).toContain('seed-protocol:node-globals')
    expect(names).toContain('seed-protocol:polyfill-resolve')

    const keys = config.resolve.alias.map((entry) => String(entry.find))
    // Absolute shim aliases first; the polyfills plugin's bare aliases are dropped.
    expect(keys[0]).toBe('vite-plugin-node-polyfills/shims/buffer')
    for (const bare of ['buffer', 'node:buffer', 'process', 'node:process', 'global']) {
      expect(keys).not.toContain(bare)
    }
    expect(keys).toContain('/^stream$/')
    expect(keys.indexOf('user-lib')).toBeLessThan(keys.indexOf('/^stream$/'))
  })

  it('registers the polyfills optimizer banner plugin exactly once', async () => {
    const config = await resolvePolyfilled()
    const names = ((config.optimizeDeps.rolldownOptions?.plugins ?? []) as Array<{ name?: string }>)
      .flat()
      .map((p) => p?.name)
    expect(names.filter((n) => n === 'vite-plugin-node-polyfills:optimizer')).toHaveLength(1)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps user optimizer plugins and defines without duplicating them', async () => {
    const config = await resolvePolyfilled({
      optimizeDeps: {
        rolldownOptions: {
          plugins: [{ name: 'user-optimizer-plugin' }],
          transform: { define: { __USER_FLAG__: 'true' } },
        },
        esbuildOptions: { define: { 'process.env.FOO': '"bar"' } },
      },
    })
    const rolldownOptions = config.optimizeDeps.rolldownOptions!
    const names = ((rolldownOptions.plugins ?? []) as Array<{ name?: string }>).flat().map((p) => p?.name)
    expect(names.filter((n) => n === 'user-optimizer-plugin')).toHaveLength(1)
    expect(rolldownOptions.transform?.define).toMatchObject({
      __USER_FLAG__: 'true',
      'process.env.FOO': '"bar"',
      global: 'globalThis',
    })
  })

  it('defines global without forcing NODE_ENV or replacing user defines', async () => {
    const config = await resolvePolyfilled({ define: { 'process.platform': '"user"' } })
    expect(config.define.global).toBe('globalThis')
    expect(config.define['process.platform']).toBe('"user"')
    expect(config.define['process.env.NODE_ENV']).not.toBe('"production"')
  })

  it('injects global / process shims into index.html with the Vite mode', () => {
    const globals = seedVitePlugin({ includeNodePolyfills: true }).find(
      (p) => p.name === 'seed-protocol:node-globals',
    )!
    callConfig(globals, {}, 'development')
    const html = hookFn(globals, 'transformIndexHtml')('<html><head></head></html>') as string
    expect(html).toContain('NODE_ENV:"development"')
    expect(html.indexOf('globalThis.global=globalThis')).toBeGreaterThan(html.indexOf('<head>'))
  })
})

describe('seedVitePlugin debug: bare-globals scan', () => {
  function scan(code: string, debug = true, moduleIds?: string[]): string[] {
    const hook = hookFn(configPlugin({ debug }), 'generateBundle')
    const lines: string[] = []
    const warn = console.warn
    const log = console.log
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    console.log = () => {}
    try {
      hook.call({}, {}, { 'chunk.js': { type: 'chunk', code, moduleIds } })
    } finally {
      console.warn = warn
      console.log = log
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

  it('stays quiet without debug', () => {
    expect(scan('export const buf = Buffer.from("x")', false)).toEqual([])
  })

  it("skips a chunk made only of Seed packages' modules, not one with app code in it", () => {
    const sdk = '/app/node_modules/@seedprotocol/sdk/dist/index.js'
    const drizzle = '/app/node_modules/@seedprotocol/sdk/dist/drizzle.js'
    expect(scan('export const buf = Buffer.from("x")', true, [sdk, drizzle])).toEqual([])
    expect(scan('export const buf = Buffer.from("x")', true, [sdk, '/app/src/main.ts'])).toEqual(['Buffer@1'])
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

describe('seedVitePlugin options', () => {
  it('rejects autoInit, which was removed, and other unknown options', () => {
    expect(() => seedVitePlugin({ autoInit: true } as SeedVitePluginOptions)).toThrow(/autoInit was removed/)
    expect(() => seedVitePlugin({ fsModule: ['fs'] } as SeedVitePluginOptions)).toThrow(/unknown option "fsModule"/)
  })

  it("polyfills timers with includeNodePolyfills (rss-parser imports it)", async () => {
    const { config } = await resolveWith('build', { includeNodePolyfills: true })
    const timers = config.resolve.alias.find((entry) => String(entry.find).replace(/[/^$]/g, '') === 'timers')
    expect(String(timers?.replacement)).toContain('timers-browserify')
  })
})
