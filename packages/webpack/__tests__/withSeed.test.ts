import { describe, expect, it } from 'vitest'
import { withSeed } from '../src/index.js'

function makeConfig() {
  return {
    plugins: [] as unknown[],
    resolve: { alias: {} as Record<string, string> },
    externals: [] as string[],
  }
}

function makeWebpack() {
  class NormalModuleReplacementPlugin {
    constructor(
      public pattern: RegExp,
      public callback: (resource: { request: string }) => void,
    ) {}
  }
  return { NormalModuleReplacementPlugin }
}

describe('withSeed', () => {
  it('sets client-side fs/path aliases', () => {
    const config = makeConfig()
    withSeed(config, makeWebpack(), false)
    expect(config.resolve.alias.fs).toBe('@zenfs/core')
    expect(config.resolve.alias.path).toBe('path-browserify')
  })

  it('adds server externals', () => {
    const config = makeConfig()
    withSeed(config, makeWebpack(), true)
    expect(config.externals).toContain('@sqlite.org/sqlite-wasm')
    expect(config.externals).toContain('chokidar')
    expect(config.externals).toContain('arweave')
  })
})
