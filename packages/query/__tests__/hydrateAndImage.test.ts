import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseArweaveClient } from '@seedprotocol/arweave'
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
      'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
    )
  })
})

describe('hydrateArweaveRichTextInItems', () => {
  beforeEach(() => {
    BaseArweaveClient.setHost('arweave.net')
    vi.restoreAllMocks()
    resetArweaveBodyCache()
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

  it('does not cache a failed fetch', async () => {
    const url = `https://arweave.net/${txId(2)}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, headers: { get: () => '' } })
      .mockResolvedValueOnce(htmlResponse('<p>later</p>'))
    vi.stubGlobal('fetch', fetchMock)

    const first = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(first)
    expect(first[0]!.html).toBe(url)

    const second = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(second)
    expect(second[0]!.html).toBe('<p>later</p>')
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
