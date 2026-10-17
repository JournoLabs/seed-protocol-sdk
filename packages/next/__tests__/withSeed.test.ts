import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextConfig } from 'next'
import { withSeed } from '../src/index'

const ZENFS_ALIASES = {
  fs: '@zenfs/core',
  'fs/promises': '@zenfs/core/promises',
  'node:fs': '@zenfs/core',
  'node:fs/promises': '@zenfs/core/promises',
}

type WebpackFn = NonNullable<NextConfig['webpack']>
type WebpackContext = Parameters<WebpackFn>[1]

function runWebpack(config: NextConfig, isServer: boolean, webpackConfig: any = { resolve: { alias: {} } }) {
  return config.webpack!(webpackConfig, { isServer } as WebpackContext)
}

const tempDirs: string[] = []

/** A throwaway app directory with the given packages "installed" (package.json only). */
function tempApp(packages: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-next-'))
  tempDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  for (const [name, version] of Object.entries(packages)) {
    const pkgDir = path.join(dir, 'node_modules', ...name.split('/'))
    fs.mkdirSync(pkgDir, { recursive: true })
    const exports = name.startsWith('@seedprotocol/') ? { './package.json': './package.json' } : undefined
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version, exports }))
  }
  return dir
}

// Each test runs as if from an app without the SDK installed, unless it sets its own cwd.
beforeEach(() => {
  vi.spyOn(process, 'cwd').mockReturnValue(tempApp())
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('withSeed turbopack aliases', () => {
  it('aliases fs to ZenFS for the browser condition only', () => {
    expect(withSeed({}).turbopack?.resolveAlias).toEqual({
      fs: { browser: '@zenfs/core' },
      'fs/promises': { browser: '@zenfs/core/promises' },
      'node:fs': { browser: '@zenfs/core' },
      'node:fs/promises': { browser: '@zenfs/core/promises' },
    })
  })

  it("keeps the user's turbopack config and lets their aliases win", () => {
    const config = withSeed({
      turbopack: { root: '/repo', resolveAlias: { fs: './my-fs.js', underscore: 'lodash' } },
    })
    expect(config.turbopack?.root).toBe('/repo')
    expect(config.turbopack?.resolveAlias).toMatchObject({
      fs: './my-fs.js',
      underscore: 'lodash',
      'node:fs': { browser: '@zenfs/core' },
    })
  })

  it('uses fsModules in place of the defaults', () => {
    expect(withSeed({}, { fsModules: ['fs'] }).turbopack?.resolveAlias).toEqual({
      fs: { browser: '@zenfs/core' },
    })
  })
})

describe('withSeed webpack', () => {
  it('aliases fs to ZenFS in the client compiler', () => {
    expect(runWebpack(withSeed({}), false).resolve.alias).toEqual(ZENFS_ALIASES)
  })

  it('leaves the server compiler alone', () => {
    expect(runWebpack(withSeed({}), true).resolve.alias).toEqual({})
  })

  it("calls the user's webpack function and keeps their aliases", () => {
    const userWebpack = vi.fn((config) => {
      config.resolve.alias.fs = './my-fs.js'
      config.marker = true
      return config
    })
    const result = runWebpack(withSeed({ webpack: userWebpack }), false)
    expect(userWebpack).toHaveBeenCalledOnce()
    expect(result.marker).toBe(true)
    expect(result.resolve.alias.fs).toBe('./my-fs.js')
    expect(result.resolve.alias['node:fs']).toBe('@zenfs/core')
  })

  it('creates resolve.alias when the config has none', () => {
    expect(runWebpack(withSeed({}), false, {}).resolve.alias).toEqual(ZENFS_ALIASES)
  })
})

describe('withSeed SDK platform alias', () => {
  it('points the SDK platform and query at their browser entries in every graph', () => {
    const app = tempApp({ '@seedprotocol/sdk': '0.7.4', '@seedprotocol/query': '0.7.4' })
    vi.spyOn(process, 'cwd').mockReturnValue(app)
    const modules = path.join(fs.realpathSync(app), 'node_modules', '@seedprotocol')
    const config = withSeed({})

    expect(config.turbopack?.resolveAlias).toMatchObject({
      '#seed-node-platform': './node_modules/@seedprotocol/sdk/dist/platform.browser.js',
      '@seedprotocol/query': './node_modules/@seedprotocol/query/dist/index.js',
    })
    for (const isServer of [true, false]) {
      expect(runWebpack(config, isServer).resolve.alias).toMatchObject({
        '#seed-node-platform': path.join(modules, 'sdk', 'dist', 'platform.browser.js'),
        // Exact match, so @seedprotocol/query/node still resolves normally.
        '@seedprotocol/query$': path.join(modules, 'query', 'dist', 'index.js'),
      })
    }
  })

  it("keeps the user's own #seed-node-platform alias", () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tempApp({ '@seedprotocol/sdk': '0.7.4' }))
    const config = withSeed({ turbopack: { resolveAlias: { '#seed-node-platform': './mine.js' } } })
    expect(config.turbopack?.resolveAlias?.['#seed-node-platform']).toBe('./mine.js')
    const webpackConfig = { resolve: { alias: { '#seed-node-platform': '/abs/mine.js' } } }
    expect(runWebpack(config, true, webpackConfig).resolve.alias['#seed-node-platform']).toBe('/abs/mine.js')
  })

  it('adds no platform alias when the SDK is not installed', () => {
    expect(withSeed({}).turbopack?.resolveAlias).not.toHaveProperty('#seed-node-platform')
  })
})

describe('withSeed headers', () => {
  it('adds the isolation headers on every path by default', async () => {
    expect(await withSeed({}).headers!()).toEqual([
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
    ])
  })

  it('adds no headers() when isolation headers are off and the user has none', () => {
    expect(withSeed({}, { isolationHeaders: false }).headers).toBeUndefined()
  })

  it("returns only the user's headers when isolation headers are off", async () => {
    const user = [{ source: '/a', headers: [{ key: 'X-A', value: '1' }] }]
    expect(await withSeed({ headers: async () => user }, { isolationHeaders: false }).headers!()).toEqual(user)
  })

  it('applies overrides and headersSource', async () => {
    const [rule] = await withSeed({}, { isolationHeaders: { coep: 'require-corp' }, headersSource: '/app/:path*' }).headers!()
    expect(rule!.source).toBe('/app/:path*')
    expect(rule!.headers).toContainEqual({ key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' })
  })

  it("puts the user's rules after ours, so their values win for the same key", async () => {
    const user = [{ source: '/embed/:path*', headers: [{ key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none' }] }]
    const rules = await withSeed({ headers: async () => user }).headers!()
    expect(rules).toHaveLength(2)
    expect(rules[0]!.source).toBe('/:path*')
    expect(rules[1]).toEqual(user[0])
  })

  it('drops our header where a user rule for the same source sets it, ignoring case', async () => {
    const user = [{ source: '/:path*', headers: [{ key: 'cross-origin-embedder-policy', value: 'require-corp' }] }]
    const rules = await withSeed({ headers: async () => user }).headers!()
    expect(rules[0]!.headers.map((h) => h.key)).toEqual([
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
    ])
    expect(rules[1]).toEqual(user[0])
  })
})

describe('withSeed config function', () => {
  it('wraps a config function and passes phase and context through', async () => {
    const userFn = vi.fn(async (phase: string) => ({ basePath: phase === 'phase-production-build' ? '/prod' : '' }))
    const wrapped = withSeed(userFn)
    const config = await wrapped('phase-production-build', { defaultConfig: {} })
    expect(userFn).toHaveBeenCalledWith('phase-production-build', { defaultConfig: {} })
    expect(config.basePath).toBe('/prod')
    expect(config.turbopack?.resolveAlias).toHaveProperty('fs')
  })
})

describe('Next 15 Turbopack warning', () => {
  const originalTurbopack = process.env.TURBOPACK

  afterEach(() => {
    if (originalTurbopack === undefined) delete process.env.TURBOPACK
    else process.env.TURBOPACK = originalTurbopack
    vi.resetModules()
  })

  async function warningsFor(version: string, turbopack: boolean): Promise<string[]> {
    vi.spyOn(process, 'cwd').mockReturnValue(tempApp({ next: version }))
    if (turbopack) process.env.TURBOPACK = '1'
    else delete process.env.TURBOPACK
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { withSeed: freshWithSeed } = await import('../src/index')
    freshWithSeed({})
    freshWithSeed({})
    return warn.mock.calls.map((call) => String(call[0]))
  }

  it('warns once on Next 15 with Turbopack', async () => {
    const warnings = await warningsFor('15.5.28', true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/Next\.js 15 with Turbopack/)
  })

  it('does not warn on Next 15 with webpack or on Next 16 with Turbopack', async () => {
    expect(await warningsFor('15.5.28', false)).toEqual([])
    vi.resetModules()
    expect(await warningsFor('16.4.2', true)).toEqual([])
  })
})
