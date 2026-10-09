import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from 'vite'
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
    const result = configPlugin.config!({ resolve: { alias: [] }, optimizeDeps: {} })

    const aliases = result?.resolve?.alias
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

  it('prebundles viem/isows only when the app root can resolve them', () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-root-'))
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-vite-root-'))
    try {
      for (const dep of ['viem', 'isows']) {
        const pkgDir = path.join(appRoot, 'node_modules', dep)
        fs.mkdirSync(pkgDir, { recursive: true })
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: dep }))
      }
      const configPlugin = getConfigPlugin()

      const bare = callConfig(configPlugin, { root: bareRoot })
      expect(bare.optimizeDeps.include).not.toContain('viem')
      expect(bare.optimizeDeps.include).not.toContain('isows')

      const withDeps = callConfig(configPlugin, { root: appRoot })
      expect(withDeps.optimizeDeps.include).toContain('viem')
      expect(withDeps.optimizeDeps.include).toContain('isows')
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true })
      fs.rmSync(appRoot, { recursive: true, force: true })
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
