import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseArweaveClient } from '../../src/ArweaveClient/BaseArweaveClient.js'
import {
  isGatewayHostCircuitOpen,
  resetGatewayCircuitBreakerForTests,
} from '../../src/gateway/gatewayCircuitBreaker.js'
import { setPreferredArweaveReadBaseUrls, setResolvedSeedGatewayEndpoints } from '../../src/gateway/gatewayState.js'
import { fetchTransactionStatusAcrossGateways } from '../../src/gateway/transactionStatus.js'

const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const A = 'https://a.example'
const B = 'https://b.example'
const C = 'https://c.example'

type Reply = number | 'hang' | 'error'

/** fetch stub: each base URL answers with a status, never answers (until aborted), or rejects. */
function stubGateways(replies: Record<string, Reply>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push(url)
      const base = Object.keys(replies).find((b) => url.startsWith(`${b}/`))
      const reply = base ? replies[base] : 404
      if (reply === 'error') return Promise.reject(new TypeError('fetch failed'))
      if (reply === 'hang') {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }
      return Promise.resolve(new Response(reply === 204 ? null : 'body', { status: reply }))
    }),
  )
  return calls
}

const originalBaseUrl = BaseArweaveClient.getBaseUrl()

beforeEach(() => {
  resetGatewayCircuitBreakerForTests()
  setPreferredArweaveReadBaseUrls([])
  setResolvedSeedGatewayEndpoints(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetGatewayCircuitBreakerForTests()
  BaseArweaveClient.setHost(originalBaseUrl)
})

describe('fetchTransactionStatusAcrossGateways', () => {
  it('returns the first gateway answer and stops', async () => {
    const calls = stubGateways({ [A]: 200, [B]: 200 })
    expect(await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B] })).toEqual({ status: 200, confirmed: null })
    expect(calls).toEqual([`${A}/${TX}`])
  })

  it('reports any 2xx as 200', async () => {
    stubGateways({ [A]: 204 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A] })).status).toBe(200)
  })

  it('takes a 404 (or other 4xx) as the answer without asking other gateways', async () => {
    const calls = stubGateways({ [A]: 404, [B]: 200 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B] })).status).toBe(404)
    expect(calls).toHaveLength(1)
  })

  it('moves on after a 5xx, a 429 or a network error', async () => {
    const calls = stubGateways({ [A]: 503, [B]: 'error', [C]: 200 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B, C] })).status).toBe(200)
    expect(calls).toHaveLength(3)

    stubGateways({ [A]: 429, [B]: 404 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B] })).status).toBe(404)
  })

  it('times a hung gateway out and asks the next one', async () => {
    stubGateways({ [A]: 'hang', [B]: 200 })
    const started = Date.now()
    const status = await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B], timeoutMs: 50 })
    expect(status.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('stops at the total budget and reports 504 when the last attempt timed out', async () => {
    const calls = stubGateways({ [A]: 'hang', [B]: 'hang', [C]: 'hang' })
    const started = Date.now()
    const status = await fetchTransactionStatusAcrossGateways(TX, {
      baseUrls: [A, B, C],
      timeoutMs: 60,
      totalTimeoutMs: 100,
    })
    expect(status).toEqual({ status: 504, confirmed: null })
    expect(calls).toHaveLength(2)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('reports the last failure when every gateway fails', async () => {
    stubGateways({ [A]: 'error', [B]: 502 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B] })).status).toBe(502)
  })

  it('skips gateways whose circuit is open, unless every one is', async () => {
    stubGateways({ [A]: 503 })
    for (let i = 0; i < 10 && !isGatewayHostCircuitOpen(A); i++) {
      await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A] })
    }
    expect(isGatewayHostCircuitOpen(A)).toBe(true)

    const calls = stubGateways({ [A]: 200, [B]: 404 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A, B] })).status).toBe(404)
    expect(calls).toEqual([`${B}/${TX}`])

    const onlyOpen = stubGateways({ [A]: 200 })
    expect((await fetchTransactionStatusAcrossGateways(TX, { baseUrls: [A] })).status).toBe(200)
    expect(onlyOpen).toHaveLength(1)
  })

  it('by default asks the configured host first, then the public fallbacks', async () => {
    BaseArweaveClient.setHost('https://primary.example')
    const calls = stubGateways({ 'https://primary.example': 503 })
    await fetchTransactionStatusAcrossGateways(TX, { timeoutMs: 50 })
    expect(calls[0]).toBe(`https://primary.example/${TX}`)
    expect(calls[1]).toBe(`https://arweave.net/${TX}`)
  })

  it('only asks the proxy when a proxy is the active path', async () => {
    const proxy = 'https://app.example.com/api/seed-gateway'
    setResolvedSeedGatewayEndpoints({
      mode: 'http-gateway',
      arweaveHost: 'app.example.com/api/seed-gateway',
      arweaveProtocol: 'https',
      arweaveBaseUrl: proxy,
      arweaveGraphqlUrl: `${proxy}/graphql`,
      uploadApiBaseUrl: proxy,
      activePath: 'http-proxy',
    })
    const calls = stubGateways({ [proxy]: 503 })
    expect((await fetchTransactionStatusAcrossGateways(TX)).status).toBe(503)
    expect(calls).toEqual([`${proxy}/${TX}`])
  })
})
