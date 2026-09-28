import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { seedVitePlugin } from '../../src/index.js'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(testDir, '../fixtures/consumer-app')
const repoRoot = path.resolve(testDir, '../../../..')

function consumerAliases() {
  return {
    '@seedprotocol/eas/utils': path.join(repoRoot, 'packages/eas/src/utils.ts'),
    '@seedprotocol/query/cache-config': path.join(
      repoRoot,
      'packages/query/src/cache/config.ts',
    ),
    pluralize: path.join(repoRoot, 'packages/query/node_modules/pluralize'),
  }
}

function consumerPlugins(polyfills: boolean) {
  return [
    react(),
    ...seedVitePlugin({ includeNodePolyfills: polyfills }),
  ]
}

describe('seedVitePlugin consumer integration', () => {
  let server: ViteDevServer | undefined

  beforeAll(async () => {
    server = await createServer({
      root: fixtureRoot,
      configFile: false,
      mode: 'development',
      logLevel: 'error',
      plugins: consumerPlugins(false),
      resolve: { alias: consumerAliases() },
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        fs: { allow: [repoRoot] },
      },
    })
    await server.listen()
  }, 60_000)

  afterAll(async () => {
    await server?.close()
  })

  it('keeps React Refresh runtime callable in development', async () => {
    const app = await server!.transformRequest('/App.tsx')
    expect(app?.code).toBeTruthy()
    expect(app!.code).toContain('RefreshRuntime')
    expect(app!.code).toContain('$RefreshReg$')
    const refresh = await server!.transformRequest('/@react-refresh')
    expect(refresh?.code).toBeTruthy()
    expect(refresh!.code).toContain('injectIntoGlobalHook')
    expect(refresh!.code).not.toMatch(/injectIntoGlobalHook is not a function/)
  })

  it('resolves eas checksumAddress and pluralize without named/default export errors', async () => {
    const transformed = await server!.transformRequest('/App.tsx')
    expect(transformed?.code).toBeTruthy()
    expect(transformed!.code).not.toMatch(/does not provide an export named/)
    const eas = await import(path.join(repoRoot, 'packages/eas/src/utils.ts'))
    expect(eas.checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
  })

  it('ssrLoadModule of the ESM fixture does not throw module is not defined', async () => {
    await expect(server!.ssrLoadModule('/ssr-entry.ts')).resolves.toBeTruthy()
  })

  it('sends isolation headers on HTML and JS, including writeHead-only handlers', async () => {
    const url = server!.resolvedUrls?.local[0]
    expect(url).toBeTruthy()
    const htmlRes = await fetch(url!)
    expect(htmlRes.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(htmlRes.headers.get('cross-origin-embedder-policy')).toBe('credentialless')
    expect(htmlRes.headers.get('cross-origin-resource-policy')).toBe('same-origin')

    const jsRes = await fetch(new URL('/App.tsx', url!).href)
    expect(jsRes.headers.get('cross-origin-opener-policy')).toBe('same-origin')

    const optOut = await createServer({
      root: fixtureRoot,
      configFile: false,
      mode: 'development',
      logLevel: 'error',
      plugins: [
        react(),
        ...seedVitePlugin({ includeNodePolyfills: false, isolationHeaders: false }),
      ],
      resolve: { alias: consumerAliases() },
      server: {
        host: '127.0.0.1',
        port: 0,
        fs: { allow: [repoRoot] },
      },
    })
    try {
      await optOut.listen()
      const optOutUrl = optOut.resolvedUrls?.local[0]
      expect(optOutUrl).toBeTruthy()
      const optOutRes = await fetch(optOutUrl!)
      expect(optOutRes.headers.get('cross-origin-opener-policy')).toBeNull()
      expect(optOutRes.headers.get('cross-origin-embedder-policy')).toBeNull()
    } finally {
      await optOut.close()
    }
  })

  it('builds with includeNodePolyfills false without stream-browserify', async () => {
    const result = await build({
      root: fixtureRoot,
      configFile: false,
      logLevel: 'error',
      plugins: consumerPlugins(false),
      resolve: { alias: consumerAliases() },
      build: {
        write: false,
        minify: false,
      },
    })
    const outputs = Array.isArray(result) ? result : [result]
    const code = outputs
      .flatMap((r) => r.output)
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('\n')
    expect(code).not.toContain('stream-browserify')
    expect(code).not.toMatch(/from ['"]node:crypto['"]/)
    expect(code).not.toMatch(/from ['"]node:path['"]/)
  }, 60_000)

  it('ssrLoadModule still works with default polyfills (no stream in include)', async () => {
    const polyfillServer = await createServer({
      root: fixtureRoot,
      configFile: false,
      mode: 'development',
      logLevel: 'error',
      plugins: consumerPlugins(true),
      resolve: { alias: consumerAliases() },
      server: { middlewareMode: true, fs: { allow: [repoRoot] } },
    })
    try {
      await expect(polyfillServer.ssrLoadModule('/ssr-entry.ts')).resolves.toBeTruthy()
    } finally {
      await polyfillServer.close()
    }
  }, 60_000)
})
