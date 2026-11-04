import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { BaseArweaveClient } from '@seedprotocol/sdk'
import { initPublish, setConfigRef } from '~/config'
import { fetchWinstonPerByte } from './marketRates'

const realFetch = globalThis.fetch
const originalHost = BaseArweaveClient.getBaseUrl()

/** Answers each URL from `routes` by prefix, 404 otherwise, and records what was asked. */
function serve(routes: Record<string, () => Response>): string[] {
  const requested: string[] = []
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    requested.push(url)
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    return match ? routes[match]!() : new Response('Cannot GET', { status: 404 })
  }) as typeof fetch
  return requested
}

beforeEach(() => {
  // An upload proxy that, like ar.seedprotocol.io, has no /price route.
  BaseArweaveClient.setHost('https://proxy.example.test')
})

afterEach(() => {
  globalThis.fetch = realFetch
  BaseArweaveClient.setHost(originalHost)
  setConfigRef(null)
})

describe('fetchWinstonPerByte', () => {
  test("uses Turbo's price first", async () => {
    const requested = serve({
      'https://payment.ardrive.io/v1/price/bytes/1000000': () => Response.json({ winc: '14000000000', adjustments: [] }),
    })
    expect(await fetchWinstonPerByte()).toBe(14_000)
    expect(requested).toEqual(['https://payment.ardrive.io/v1/price/bytes/1000000'])
  })

  test("asks the configured Turbo payment service with user-paid storage", async () => {
    initPublish({
      uploadApiBaseUrl: 'https://example.test',
      payment: { storage: 'user', userStorage: { paymentUrl: 'https://pay.example.test' } },
    })
    const requested = serve({
      'https://pay.example.test/v1/price/bytes/': () => Response.json({ winc: '2000000' }),
    })
    expect(await fetchWinstonPerByte()).toBe(2)
    expect(requested).toEqual(['https://pay.example.test/v1/price/bytes/1000000'])
  })

  test("falls back to arweave.net's /price when Turbo is down and the gateway has no /price", async () => {
    const requested = serve({
      'https://payment.ardrive.io/': () => new Response('down', { status: 503 }),
      'https://arweave.net/price/1000000': () => new Response('15000000000'),
    })
    expect(await fetchWinstonPerByte()).toBe(15_000)
    expect(requested).toEqual([
      'https://payment.ardrive.io/v1/price/bytes/1000000',
      'https://proxy.example.test:443/price/1000000',
      'https://arweave.net/price/1000000',
    ])
  })

  test("uses the configured gateway's /price before arweave.net", async () => {
    const requested = serve({
      'https://payment.ardrive.io/': () => Response.json({ winc: '0' }),
      'https://proxy.example.test:443/price/': () => new Response('16000000000'),
    })
    expect(await fetchWinstonPerByte()).toBe(16_000)
    expect(requested).not.toContain('https://arweave.net/price/1000000')
  })

  test('throws with every source’s failure when none answers', async () => {
    serve({})
    await expect(fetchWinstonPerByte()).rejects.toThrow(/No Arweave storage price: Turbo price lookup failed: HTTP 404; .*proxy.*404; .*arweave\.net.*404/)
  })
})
