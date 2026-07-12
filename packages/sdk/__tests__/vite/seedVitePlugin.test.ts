import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedVitePlugin } from '../../src/vite/index'

const sdkViteDir = path.dirname(fileURLToPath(import.meta.url))
const vitePluginSrcDir = path.resolve(sdkViteDir, '../../src/vite')

function getConfigPlugin() {
  const plugins = seedVitePlugin({ includeNodePolyfills: false })
  const configPlugin = plugins.find((p) => p.name === 'seed-protocol:config')
  if (!configPlugin?.config) {
    throw new Error('seed-protocol:config plugin not found')
  }
  return configPlugin
}

function aliasFindToString(find: string | RegExp): string {
  return typeof find === 'string' ? find : find.source
}

describe('seedVitePlugin renderer hardening', () => {
  it('exposes debug interop shim next to plugin sources', () => {
    const shimPath = path.join(vitePluginSrcDir, 'debug-default-shim.js')
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
    expect(aliasKeys.some((k) => k.includes('debug\\/src\\/browser'))).toBe(false)

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
})
