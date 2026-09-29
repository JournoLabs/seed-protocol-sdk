import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import {
  ensureReadGatewaySelected,
  invalidateReadGatewayCache,
  isReadGatewayKnownHealthy,
  getLastHealthyReadGatewayHost,
  probeGateway,
  resetArweaveReadGatewayForTests,
  selectFirstHealthyReadGateway,
  isGatewayHostCircuitOpen,
} from '@/helpers/ArweaveClient/selectReadGateway'
import {
  DEFAULT_ARWEAVE_HOST,
  getDefaultArweaveReadGatewayHostsOrdered,
  mergePrimaryHostWithDefaults,
} from '@/helpers/constants'

describe('mergePrimaryHostWithDefaults', () => {
  it('dedupes case-insensitively and preserves primary first', () => {
    expect(mergePrimaryHostWithDefaults('a.com', ['b.net', 'A.com', 'c.io'])).toEqual(['a.com', 'b.net', 'c.io'])
  })
})

describe('getDefaultArweaveReadGatewayHostsOrdered', () => {
  const originalRead = process.env.ARWEAVE_READ_GATEWAYS
  const originalNext = process.env.NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS

  afterEach(() => {
    if (originalRead === undefined) delete process.env.ARWEAVE_READ_GATEWAYS
    else process.env.ARWEAVE_READ_GATEWAYS = originalRead
    if (originalNext === undefined) delete process.env.NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS
    else process.env.NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS = originalNext
  })

  it('returns env list when ARWEAVE_READ_GATEWAYS is set', () => {
    delete process.env.NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS
    process.env.ARWEAVE_READ_GATEWAYS = ' one.example , two.example '
    expect(getDefaultArweaveReadGatewayHostsOrdered()).toEqual(['one.example', 'two.example'])
  })
})

describe('probeGateway / selectFirstHealthyReadGateway', () => {
  beforeEach(() => {
    resetArweaveReadGatewayForTests()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const s = String(url)
        if (s.endsWith('/info')) {
          return new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })
        }
        return new Response('', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetArweaveReadGatewayForTests()
  })

  it('probeGateway returns true for JSON /info', async () => {
    await expect(probeGateway('https://arweave.net')).resolves.toBe(true)
  })

  it('selectFirstHealthyReadGateway returns first healthy host', async () => {
    const h = await selectFirstHealthyReadGateway(['a.example', 'b.example'], 'https')
    expect(h).toBe('a.example')
  })

  it('selectFirstHealthyReadGateway skips hosts with an open circuit', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const s = String(url)
      if (s.includes('a.example')) {
        throw new Error('ECONNRESET')
      }
      return new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await selectFirstHealthyReadGateway(['a.example', 'b.example'], 'https')
    expect(first).toBe('b.example')
    expect(isGatewayHostCircuitOpen('a.example')).toBe(true)

    fetchMock.mockClear()
    const second = await selectFirstHealthyReadGateway(['a.example', 'b.example'], 'https')
    expect(second).toBe('b.example')
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('a.example'))).toBe(false)
  })
})

describe('ensureReadGatewaySelected', () => {
  beforeEach(() => {
    resetArweaveReadGatewayForTests()
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetArweaveReadGatewayForTests()
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
  })

  it('applies first gateway that passes /info probe', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const s = String(url)
      if (s.includes('ar.seedprotocol.io')) {
        return new Response('not json', { status: 200 })
      }
      if (s.includes('arweave.net')) {
        return new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })
      }
      return new Response('', { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const host = await ensureReadGatewaySelected()
    expect(host).toBe('arweave.net')
    expect(BaseArweaveClient.getHost()).toBe('arweave.net')
    expect(isReadGatewayKnownHealthy()).toBe(true)
    expect(getLastHealthyReadGatewayHost()).toBe('arweave.net')
  })

  it('does not fetch when read gateway is locked', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    BaseArweaveClient.setHost('locked.example.com')
    invalidateReadGatewayCache()

    const host = await ensureReadGatewaySelected()
    expect(host).toBe('locked.example.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks selection unhealthy when all probes fail and keeps last healthy host', async () => {
    const okFetch = vi.fn(async (url: string | URL) => {
      const s = String(url)
      if (s.includes('arweave.net')) {
        return new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })
      }
      return new Response('not json', { status: 200 })
    })
    vi.stubGlobal('fetch', okFetch)
    await ensureReadGatewaySelected()
    expect(getLastHealthyReadGatewayHost()).toBe('arweave.net')

    invalidateReadGatewayCache()
    const failFetch = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    vi.stubGlobal('fetch', failFetch)

    const host = await ensureReadGatewaySelected()
    expect(host).toBe('arweave.net')
    expect(isReadGatewayKnownHealthy()).toBe(false)
    expect(getLastHealthyReadGatewayHost()).toBe('arweave.net')

    failFetch.mockClear()
    // Unhealthy cache should prevent immediate re-probe
    await ensureReadGatewaySelected()
    expect(failFetch).not.toHaveBeenCalled()
  })
})
