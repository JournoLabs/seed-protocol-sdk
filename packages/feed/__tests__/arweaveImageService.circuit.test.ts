import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BaseArweaveClient,
  isGatewayHostCircuitOpen,
  recordGatewayHostFailure,
  resetArweaveReadGatewayForTests,
  setPreferredArweaveReadBaseUrls,
  setResolvedSeedGatewayEndpoints,
} from '@seedprotocol/arweave'
import { ArweaveImageService } from '../src/services/arweaveImageService'

function mockGatewayFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const s = String(url)
    if (s.endsWith('/info')) {
      return new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })
    }
    return handler(s, init)
  })
}

describe('ArweaveImageService circuit breaker', () => {
  beforeEach(() => {
    resetArweaveReadGatewayForTests()
    setResolvedSeedGatewayEndpoints(null)
    BaseArweaveClient.setPreferredReadGateway('ar.seedprotocol.io')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetArweaveReadGatewayForTests()
    setResolvedSeedGatewayEndpoints(null)
    setPreferredArweaveReadBaseUrls([])
  })

  it('tries preferred read gateways before the configured list', async () => {
    setPreferredArweaveReadBaseUrls(['https://app.example.com/api/seed-gateway'])
    const fetchMock = mockGatewayFetch(async (s, init) => {
      if (!s.startsWith('https://app.example.com/api/seed-gateway/')) {
        throw new Error(`unexpected ${s}`)
      }
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '100' },
        })
      }
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
        status: 206,
        headers: { 'content-type': 'image/png' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = new ArweaveImageService({ gateways: ['arweave.net'], timeout: 5_000 })
    const tx = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
    const meta = await service.detectImage(tx)

    expect(meta.isImage).toBe(true)
    expect(meta.url).toBe(`https://app.example.com/api/seed-gateway/${tx}`)
  })

  it('skips hosts with an open circuit and tries the next gateway', async () => {
    recordGatewayHostFailure('ar.seedprotocol.io')
    expect(isGatewayHostCircuitOpen('ar.seedprotocol.io')).toBe(true)

    const fetchMock = mockGatewayFetch(async (s, init) => {
      if (s.includes('ar.seedprotocol.io')) {
        throw new Error('should not be called for media')
      }
      if (init?.method === 'HEAD' || !init?.method) {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '100' },
        })
      }
      const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      return new Response(pngHeader, {
        status: 206,
        headers: { 'content-type': 'image/png' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = new ArweaveImageService({
      gateways: ['ar.seedprotocol.io', 'arweave.net'],
      timeout: 5_000,
    })

    const tx = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
    const meta = await service.detectImage(tx)

    const mediaCalls = fetchMock.mock.calls.filter((c) => !String(c[0]).endsWith('/info'))
    expect(mediaCalls.some((c) => String(c[0]).includes('ar.seedprotocol.io'))).toBe(false)
    expect(mediaCalls.some((c) => String(c[0]).includes('arweave.net'))).toBe(true)
    expect(meta.isImage).toBe(true)
    expect(meta.url).toContain('arweave.net')
  })

  it('opens the circuit after a network failure so later detects skip that host', async () => {
    const fetchMock = mockGatewayFetch(async (s, init) => {
      if (s.includes('dead.example')) {
        throw new Error('ECONNRESET')
      }
      if (init?.method === 'HEAD' || !init?.method) {
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': '50' },
        })
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 206,
        headers: { 'content-type': 'image/jpeg' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = new ArweaveImageService({
      gateways: ['dead.example', 'arweave.net'],
      timeout: 5_000,
    })

    const tx = '05eY_BXxztbTacIqutY1S5FUXgzq4ock3x2pDHMQqmY'
    await service.detectImage(tx)
    expect(isGatewayHostCircuitOpen('dead.example')).toBe(true)

    fetchMock.mockClear()
    await service.detectImage(tx)
    const mediaCalls = fetchMock.mock.calls.filter((c) => !String(c[0]).endsWith('/info'))
    expect(mediaCalls.some((c) => String(c[0]).includes('dead.example'))).toBe(false)
  })
})
