import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { BaseArweaveClient } from '../../src/ArweaveClient/BaseArweaveClient.js'
import { resetArweaveReadGatewayForTests } from '../../src/ArweaveClient/selectReadGateway.js'
import {
  getPreferredArweaveReadBaseUrls,
  setPreferredArweaveReadBaseUrls,
  setResolvedSeedGatewayEndpoints,
} from '../../src/gateway/gatewayState.js'
import {
  fetchArweaveRawTextAcrossGateways,
  getArweaveReadBaseUrls,
} from '../../src/gateway/readBaseUrls.js'
import type { ResolvedSeedGatewayEndpoints } from '../../src/types/gateway.js'

const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const PROXY = 'https://app.example.com/api/seed-gateway'

function resolved(
  overrides: Partial<ResolvedSeedGatewayEndpoints>,
): ResolvedSeedGatewayEndpoints {
  return {
    mode: 'http-gateway',
    arweaveHost: 'arweave.net',
    arweaveProtocol: 'https',
    arweaveBaseUrl: 'https://arweave.net',
    arweaveGraphqlUrl: 'https://arweave.net/graphql',
    uploadApiBaseUrl: 'https://arweave.net',
    activePath: 'http',
    ...overrides,
  }
}

const originalBaseUrl = BaseArweaveClient.getBaseUrl()

beforeEach(() => {
  resetArweaveReadGatewayForTests()
  setPreferredArweaveReadBaseUrls([])
  setResolvedSeedGatewayEndpoints(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  setPreferredArweaveReadBaseUrls([])
  setResolvedSeedGatewayEndpoints(null)
  BaseArweaveClient.setHost(originalBaseUrl)
})

describe('setPreferredArweaveReadBaseUrls', () => {
  it('trims, drops trailing slashes, empties and duplicates (scheme/host case-insensitive)', () => {
    setPreferredArweaveReadBaseUrls([` ${PROXY}/ `, '', 'HTTPS://APP.EXAMPLE.COM/api/seed-gateway', 'http://127.0.0.1:1984'])
    expect(getPreferredArweaveReadBaseUrls()).toEqual([PROXY, 'http://127.0.0.1:1984'])
  })

  it('defaults a bare host to https', () => {
    setPreferredArweaveReadBaseUrls(['ar.example.com'])
    expect(getPreferredArweaveReadBaseUrls()).toEqual(['https://ar.example.com'])
  })

  it('drops a relative path when there is no browser origin', () => {
    setPreferredArweaveReadBaseUrls(['/api/seed-gateway', PROXY])
    expect(getPreferredArweaveReadBaseUrls()).toEqual([PROXY])
  })

  it('resolves a relative path against window.location.origin', () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example.com' } })
    setPreferredArweaveReadBaseUrls(['/api/seed-gateway'])
    expect(getPreferredArweaveReadBaseUrls()).toEqual([PROXY])
  })

  it('clears with an empty list', () => {
    setPreferredArweaveReadBaseUrls([PROXY])
    setPreferredArweaveReadBaseUrls([])
    expect(getPreferredArweaveReadBaseUrls()).toEqual([])
  })
})

describe('getArweaveReadBaseUrls', () => {
  it('puts preferred gateways ahead of the public list on the plain http path', () => {
    BaseArweaveClient.setHost('https://arweave.net')
    setResolvedSeedGatewayEndpoints(resolved({ activePath: 'http' }))
    setPreferredArweaveReadBaseUrls([PROXY])

    const urls = getArweaveReadBaseUrls()
    expect(urls[0]).toBe(PROXY)
    expect(urls[1]).toBe('https://arweave.net')
    expect(urls.length).toBeGreaterThan(2)
    expect(urls.every((u) => /^https:\/\//.test(u))).toBe(true)
  })

  it('keeps the proxy-only list on http-proxy and dedupes a preferred URL equal to it', () => {
    BaseArweaveClient.setHost(PROXY)
    setResolvedSeedGatewayEndpoints(
      resolved({ activePath: 'http-proxy', arweaveHost: 'app.example.com/api/seed-gateway' }),
    )
    setPreferredArweaveReadBaseUrls([PROXY])
    expect(getArweaveReadBaseUrls()).toEqual([PROXY])
  })

  it('mixes schemes: https preferred ahead of an http sidecar', () => {
    BaseArweaveClient.setHost('http://127.0.0.1:1984')
    setResolvedSeedGatewayEndpoints(
      resolved({ activePath: 'hyper-sidecar', arweaveHost: '127.0.0.1:1984', arweaveProtocol: 'http' }),
    )
    setPreferredArweaveReadBaseUrls([PROXY])
    expect(getArweaveReadBaseUrls()).toEqual([PROXY, 'http://127.0.0.1:1984'])
  })

  it('uses the public list on hybrid-fallback-http', () => {
    BaseArweaveClient.setHost('https://ar.seedprotocol.io')
    setResolvedSeedGatewayEndpoints(
      resolved({ mode: 'hybrid', activePath: 'hybrid-fallback-http', arweaveHost: 'ar.seedprotocol.io' }),
    )
    const urls = getArweaveReadBaseUrls()
    expect(urls[0]).toBe('https://ar.seedprotocol.io')
    expect(urls.length).toBeGreaterThan(1)
  })

  it('uses fallbackHosts when nothing is resolved', () => {
    BaseArweaveClient.setHost('https://arweave.net')
    setPreferredArweaveReadBaseUrls([PROXY])
    expect(getArweaveReadBaseUrls({ fallbackHosts: ['a.example', 'b.example/'] })).toEqual([
      PROXY,
      'https://a.example',
      'https://b.example',
    ])
  })
})

describe('fetchArweaveRawTextAcrossGateways', () => {
  beforeEach(() => {
    BaseArweaveClient.setHost('https://arweave.net')
    setResolvedSeedGatewayEndpoints(resolved({ activePath: 'http' }))
  })

  it('returns the preferred gateway body without touching public hosts', async () => {
    setPreferredArweaveReadBaseUrls([PROXY])
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).startsWith(PROXY)) return new Response('<p>hi</p>', { status: 200 })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchArweaveRawTextAcrossGateways(TX)).resolves.toBe('<p>hi</p>')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${PROXY}/raw/${TX}`)
  })

  it('falls back to public hosts when the preferred gateway 404s', async () => {
    setPreferredArweaveReadBaseUrls([PROXY])
    const fetchMock = vi.fn(async (url: string | URL) => {
      const s = String(url)
      if (s.startsWith(PROXY)) return new Response('nope', { status: 404 })
      if (s.startsWith('https://arweave.net/raw/')) return new Response('body', { status: 200 })
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchArweaveRawTextAcrossGateways(TX)).resolves.toBe('body')
  })

  it('moves on when the preferred gateway hangs past the timeout', async () => {
    setPreferredArweaveReadBaseUrls([PROXY])
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith(PROXY)) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
      return Promise.resolve(new Response('public', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchArweaveRawTextAcrossGateways(TX, { timeoutMs: 20 })).resolves.toBe('public')
  })

  it('returns undefined when every gateway fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(fetchArweaveRawTextAcrossGateways(TX)).resolves.toBeUndefined()
  })
})

describe('BaseArweaveClient.getArweaveJsApiConfig', () => {
  it('uses 443 for an https host without a port', () => {
    BaseArweaveClient.setHost('arweave.net')
    expect(BaseArweaveClient.getArweaveJsApiConfig()).toEqual({
      host: 'arweave.net',
      port: 443,
      protocol: 'https',
    })
  })

  it('splits host and port for a local sidecar', () => {
    BaseArweaveClient.setHost('http://127.0.0.1:1984')
    expect(BaseArweaveClient.getArweaveJsApiConfig()).toEqual({
      host: '127.0.0.1',
      port: 1984,
      protocol: 'http',
    })
  })

  it('drops a proxy path prefix', () => {
    BaseArweaveClient.setHost('https://app.example.com:8443/api/seed-gateway')
    expect(BaseArweaveClient.getArweaveJsApiConfig()).toEqual({
      host: 'app.example.com',
      port: 8443,
      protocol: 'https',
    })
  })

  it('handles IPv6 hosts', () => {
    BaseArweaveClient.setHost('http://[::1]:1984')
    expect(BaseArweaveClient.getArweaveJsApiConfig()).toEqual({
      host: '[::1]',
      port: 1984,
      protocol: 'http',
    })
  })

  it("keeps the page's port out of the arweave web client", () => {
    vi.stubGlobal('location', {
      protocol: 'https:',
      hostname: 'local.app.permapress.xyz',
      port: '43844',
    })
    const require = createRequire(import.meta.url)
    const ArweaveWeb = require('arweave/web/index.js').default

    BaseArweaveClient.setHost('arweave.net')
    // Without a port, arweave web init inherits location.port — the bug this guards against.
    expect(ArweaveWeb.init({ host: 'arweave.net', protocol: 'https' }).api.config.port).toBe(43844)
    expect(ArweaveWeb.init(BaseArweaveClient.getArweaveJsApiConfig()).api.config.port).toBe(443)
  })
})
