import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  hydrateArweaveRichTextInFeedItems,
  isArweaveTransactionGatewayUrl,
} from '../src/hydrateArweaveRichText'

describe('hydrateArweaveRichText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isArweaveTransactionGatewayUrl accepts standard gateway tx URL', () => {
    expect(
      isArweaveTransactionGatewayUrl(
        'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
      )
    ).toBe(true)
  })

  it('isArweaveTransactionGatewayUrl rejects non-tx paths', () => {
    expect(isArweaveTransactionGatewayUrl('https://arweave.net/raw/abc')).toBe(false)
    expect(isArweaveTransactionGatewayUrl('https://example.com/tx')).toBe(false)
  })

  it('hydrateArweaveRichTextInFeedItems replaces gateway html with fetched UTF-8', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    const html = '<article><p>Hello</p></article>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      })
    )

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInFeedItems(items)

    expect(items[0]!.html).toBe(html)
    expect(fetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: expect.any(String) }),
      })
    )
  })

  it('skips image responses', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new ArrayBuffer(10),
      })
    )

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInFeedItems(items)

    expect(items[0]!.html).toBe(url)
  })

  it('hydrates non-legacy field when _feedFieldStorageModels marks it as html', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    const html = '<main>typed</main>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      })
    )

    const items = [
      {
        article_html: url,
        _feedFieldStorageModels: { article_html: 'html' },
      },
    ] as Record<string, unknown>[]
    await hydrateArweaveRichTextInFeedItems(items)

    expect(items[0]!.article_html).toBe(html)
  })

  it('hydrates typed html slot inside a list', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    const html = '<section>list</section>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      })
    )

    const items = [
      {
        blocks: ['skip', url],
        _feedListElementStorageModels: { blocks: ['image', 'html'] },
      },
    ] as Record<string, unknown>[]
    await hydrateArweaveRichTextInFeedItems(items)

    const arr = items[0]!.blocks as string[]
    expect(arr[0]).toBe('skip')
    expect(arr[1]).toBe(html)
  })
})
