import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BaseArweaveClient,
  isGatewayHostCircuitOpen,
  resetGatewayCircuitBreakerForTests,
  setArweaveContentReadTransform,
} from '@seedprotocol/arweave'
import { enrichImageSeedClone } from '../src/imageRelationEnrichment'
import {
  hydrateArweaveRichTextInItems,
  isArweaveTransactionGatewayUrl,
  resetArweaveBodyCache,
} from '../src/hydrateArweaveRichText'

const txId = (n: number) => `tx${String(n).padStart(41, '0')}`

const htmlResponse = (html: string) => ({
  ok: true,
  headers: { get: () => 'text/html; charset=utf-8' },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
})

describe('enrichImageSeedClone', () => {
  beforeEach(() => {
    BaseArweaveClient.setHost('arweave.net')
  })

  it('adds arweaveUrl from storageTransactionId', () => {
    const clone: Record<string, unknown> = {
      storageTransactionId: 'LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
    }
    enrichImageSeedClone(clone)
    expect(clone.arweaveUrl).toBe(
      'https://arweave.net/raw/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
    )
  })

  it('falls back to storage_transaction_id', () => {
    const clone: Record<string, unknown> = {
      storage_transaction_id: '05eY_BXxztbTacIqutY1S5FUXgzq4ock3x2pDHMQqmY',
    }
    enrichImageSeedClone(clone)
    expect(clone.arweaveUrl).toBe(
      'https://arweave.net/raw/05eY_BXxztbTacIqutY1S5FUXgzq4ock3x2pDHMQqmY',
    )
  })

  it('leaves arweaveUrl unset without a storage transaction', () => {
    const clone: Record<string, unknown> = { seedUid: '0xabc' }
    enrichImageSeedClone(clone)
    expect(clone.arweaveUrl).toBeUndefined()
  })
})

describe('hydrateArweaveRichTextInItems', () => {
  beforeEach(() => {
    BaseArweaveClient.setHost('arweave.net')
    vi.restoreAllMocks()
    resetArweaveBodyCache()
    resetGatewayCircuitBreakerForTests()
  })

  it('isArweaveTransactionGatewayUrl accepts standard gateway tx URL', () => {
    expect(
      isArweaveTransactionGatewayUrl(
        'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
      ),
    ).toBe(true)
  })

  it('replaces gateway html with fetched UTF-8', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    const html = '<article><p>Hello</p></article>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      }),
    )

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe(html)
  })

  it('hydrates through the Arweave content read transform', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('<p>sealed</p>')))
    const seen: string[] = []
    setArweaveContentReadTransform(({ bytes }, { transactionId }) => {
      seen.push(transactionId)
      return { bytes: new TextEncoder().encode(new TextDecoder().decode(bytes).replace('sealed', 'opened')) }
    })
    try {
      const items = [{ html: url }] as Record<string, unknown>[]
      await hydrateArweaveRichTextInItems(items)
      expect(items[0]!.html).toBe('<p>opened</p>')
      expect(seen).toEqual(['LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'])
    } finally {
      setArweaveContentReadTransform(undefined)
    }
  })

  it('fetches a transaction once, across calls, concurrent fields and gateways', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('<p>body</p>'))
    vi.stubGlobal('fetch', fetchMock)

    const items = [
      { html: `https://arweave.net/${txId(1)}`, body: `https://arweave.net/${txId(1)}` },
      { html: `https://ar-io.net/${txId(1)}` },
    ] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    const again = [{ html: `https://arweave.net/${txId(1)}` }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(again)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect([items[0]!.html, items[0]!.body, items[1]!.html, again[0]!.html]).toEqual(
      Array(4).fill('<p>body</p>'),
    )
  })

  it('does not cache a fetch every gateway failed', async () => {
    const url = `https://arweave.net/${txId(2)}`
    let published = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (published ? htmlResponse('<p>later</p>') : { ok: false, headers: { get: () => '' } })),
    )

    const first = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(first)
    expect(first[0]!.html).toBe(url)

    published = true
    resetGatewayCircuitBreakerForTests()
    const second = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(second)
    expect(second[0]!.html).toBe('<p>later</p>')
  })

  it('fetches the body from the next read gateway when the first fails', async () => {
    const url = `https://arweave.net/${txId(5)}`
    const fetchMock = vi.fn(async (requested: string) =>
      requested.startsWith('https://arweave.net/')
        ? { ok: false, headers: { get: () => '' } }
        : htmlResponse('<p>from a fallback</p>'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe('<p>from a fallback</p>')
    expect(fetchMock.mock.calls[0]![0]).toBe(url)
  })

  it('tries the next gateway on a 404 without opening the first gateway\'s circuit', async () => {
    const url = `https://arweave.net/${txId(6)}`
    vi.stubGlobal(
      'fetch',
      vi.fn(async (requested: string) =>
        requested.startsWith('https://arweave.net/')
          ? { ok: false, status: 404, headers: { get: () => '' } }
          : htmlResponse('<p>from a fallback</p>'),
      ),
    )

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe('<p>from a fallback</p>')
    expect(isGatewayHostCircuitOpen('https://arweave.net')).toBe(false)
  })

  it('opens a gateway\'s circuit on a 5xx or 429', async () => {
    for (const [n, status] of [[7, 503], [8, 429]] as const) {
      resetGatewayCircuitBreakerForTests()
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, headers: { get: () => '' } })))
      await hydrateArweaveRichTextInItems([{ html: `https://arweave.net/${txId(n)}` }])
      expect(isGatewayHostCircuitOpen('https://arweave.net')).toBe(true)
    }
  })

  it('fetches a /raw/ link as /raw/ on each gateway', async () => {
    const url = `https://arweave.net/raw/${txId(9)}`
    const fetchMock = vi.fn(async (requested: string) =>
      requested.startsWith('https://arweave.net/')
        ? { ok: false, status: 404, headers: { get: () => '' } }
        : htmlResponse('<p>raw</p>'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe('<p>raw</p>')
    const requested = fetchMock.mock.calls.map(([u]) => u)
    expect(requested[0]).toBe(url)
    expect(requested.slice(1).every((u) => u.endsWith(`/raw/${txId(9)}`))).toBe(true)
  })

  it('moves the hydrated body\'s Arweave links onto the reader\'s first gateway', async () => {
    const image = `${'img'.padEnd(43, 'z')}`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(`<img src="https://ar.seedprotocol.io/raw/${image}">`)))

    const items = [{ html: `https://arweave.net/${txId(6)}` }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe(`<img src="https://arweave.net/raw/${image}">`)
  })

  it('fetches bodies in parallel, at most 8 at a time, each into its own item', async () => {
    let inFlight = 0
    let maxInFlight = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return htmlResponse(`<p>${url.slice(-3)}</p>`)
      }),
    )

    const items = Array.from({ length: 20 }, (_, n) => ({
      html: `https://arweave.net/${txId(100 + n)}`,
    })) as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)

    expect(maxInFlight).toBe(8)
    expect(items.map((item) => item.html)).toEqual(
      Array.from({ length: 20 }, (_, n) => `<p>${100 + n}</p>`),
    )
  })
})

describe('hydrateArweaveRichTextInItems field selection', () => {
  const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'

  beforeEach(() => {
    BaseArweaveClient.setHost('arweave.net')
    vi.restoreAllMocks()
    resetArweaveBodyCache()
  })

  it('isArweaveTransactionGatewayUrl rejects non-tx paths', () => {
    expect(isArweaveTransactionGatewayUrl('https://arweave.net/raw/abc')).toBe(false)
    expect(isArweaveTransactionGatewayUrl('https://example.com/tx')).toBe(false)
  })

  it('leaves the URL in place when the gateway returns an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new ArrayBuffer(10),
      }),
    )
    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe(url)
  })

  it('hydrates a field whose storage model is html, whatever its name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('<main>typed</main>')))
    const items = [
      { article_html: url, _feedFieldStorageModels: { article_html: 'html' } },
    ] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.article_html).toBe('<main>typed</main>')
  })

  it('hydrates only the list elements whose storage model is html', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('<section>list</section>')))
    const items = [
      { blocks: ['skip', url], _feedListElementStorageModels: { blocks: ['image', 'html'] } },
    ] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.blocks).toEqual(['skip', '<section>list</section>'])
  })
})
