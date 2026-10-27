import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARWEAVE_GRAPHQL_TIMEOUT_MS, DefaultArweaveClient } from '../../src/default/ArweaveClient.js'
import { NodeArweaveClient } from '../../src/node/ArweaveClient.js'
import { setPreferredArweaveReadBaseUrls } from '../../src/gateway/gatewayState.js'
import { BaseArweaveClient } from '../../src/ArweaveClient/BaseArweaveClient.js'

const TX = 'a'.repeat(43)

// The preferred-gateway loop used to live only in the SDK's browser client, so Node reads went
// straight to the configured host and missed data items not yet on L1.
describe('DefaultArweaveClient.getTransactionData', () => {
  afterEach(() => {
    setPreferredArweaveReadBaseUrls([])
    BaseArweaveClient.setHost('arweave.net')
    vi.unstubAllGlobals()
  })

  it.each([
    ['DefaultArweaveClient', DefaultArweaveClient],
    ['NodeArweaveClient', NodeArweaveClient],
  ])('%s reads from a preferred gateway first', async (_name, Client) => {
    setPreferredArweaveReadBaseUrls(['https://sidecar.example.com/gw'])
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('https://sidecar.example.com/gw/raw/')
        ? new Response('from-sidecar', { status: 200 })
        : new Response('wrong', { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const data = await new Client().getTransactionData(TX, { string: true })
    expect(data).toBe('from-sidecar')
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://sidecar.example.com/gw/raw/${TX}`)
  })

  it('falls through to the configured gateway when the preferred one misses', async () => {
    setPreferredArweaveReadBaseUrls(['https://sidecar.example.com'])
    BaseArweaveClient.setHost('app.example.com/api/seed-gateway')
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('https://sidecar.example.com/')
        ? new Response('', { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const data = await new DefaultArweaveClient().getTransactionData(TX)
    expect(Array.from(data as Uint8Array)).toEqual([1, 2, 3])
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(`/api/seed-gateway/raw/${TX}`)
  })

  it('skips preferred gateways when undecoded data is asked for', async () => {
    setPreferredArweaveReadBaseUrls(['https://sidecar.example.com'])
    BaseArweaveClient.setHost('app.example.com/api/seed-gateway')
    const fetchMock = vi.fn(async () => new Response('raw', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await new DefaultArweaveClient().getTransactionData(TX, { decode: false, string: true })
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('sidecar'))).toBe(true)
  })
})

describe('DefaultArweaveClient GraphQL requests', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('abort after ARWEAVE_GRAPHQL_TIMEOUT_MS when the gateway never answers', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
          }),
      ),
    )
    const pending = new DefaultArweaveClient().getArweaveClient().request('{ transactions { edges { node { id } } } }')
    const settled = expect(pending).rejects.toThrow(/timed out after 30000 ms/)
    await vi.advanceTimersByTimeAsync(ARWEAVE_GRAPHQL_TIMEOUT_MS)
    await settled
  })
})
