import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetchFeedItems = vi.fn()

vi.mock('../src/getFeedItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/getFeedItems')>()
  return {
    ...actual,
    fetchFeedItemsBySchemaName: (...args: unknown[]) => mockFetchFeedItems(...args),
  }
})

import { handleFeedRequest, resetCacheManager } from '../src/index'

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `0xseed${i}`,
    seedUid: `0xseed${i}`,
    title: `Post ${i}`,
    link: `https://example.com/posts/${i}`,
    pubDate: 'Tue, 21 Oct 2026 12:00:00 GMT',
  }))

describe('handleFeedRequest pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CACHE_ENABLED = 'false'
    process.env.IMAGE_METADATA_ENABLED = 'false'
    process.env.FEED_PAGE_SIZE = '2'
    resetCacheManager()
  })

  afterEach(() => {
    delete process.env.CACHE_ENABLED
    delete process.env.IMAGE_METADATA_ENABLED
    delete process.env.FEED_PAGE_SIZE
    resetCacheManager()
  })

  it('asks for one item past the page and links next only when it came back', async () => {
    mockFetchFeedItems.mockResolvedValue({ items: items(2) })
    const full = await (await handleFeedRequest('posts', 'atom')).text()
    expect(mockFetchFeedItems).toHaveBeenCalledWith('post', { limit: 3, skip: 0 })
    expect(full).not.toContain('rel="next"')

    mockFetchFeedItems.mockResolvedValue({ items: items(3) })
    const more = await (await handleFeedRequest('posts', 'atom')).text()
    expect(more).toContain('rel="next"')
    expect(more).not.toContain('Post 2')
  })
})
