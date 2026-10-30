import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockFetchFeedItems = vi.fn()
const mockGetMonthItems = vi.fn()

vi.mock('../src/getFeedItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/getFeedItems')>()
  return {
    ...actual,
    fetchFeedItemsBySchemaName: (...args: unknown[]) => mockFetchFeedItems(...args),
    getFeedItemsBySchemaNameForMonth: (...args: unknown[]) => mockGetMonthItems(...args),
  }
})

import { handleArchiveFeedRequest, handleFeedRequest, resetCacheManager } from '../src/index'

const post = (title: string) => ({
  id: '0xseed1',
  seedUid: '0xseed1',
  title,
  link: 'https://example.com/posts/1',
  pubDate: 'Tue, 21 Oct 2026 12:00:00 GMT',
})

describe('feed content cache keyed on query', () => {
  let cacheDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'))
    cacheDir = mkdtempSync(join(tmpdir(), 'feed-content-cache-'))
    process.env.CACHE_ENABLED = 'true'
    process.env.CACHE_DIR = cacheDir
    process.env.IMAGE_METADATA_ENABLED = 'false'
    resetCacheManager()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.CACHE_ENABLED
    delete process.env.CACHE_DIR
    delete process.env.IMAGE_METADATA_ENABLED
    resetCacheManager()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('asks query on every page 1 request and rebuilds only when its ETag changes', async () => {
    mockFetchFeedItems.mockResolvedValue({ items: [post('First')], etag: '"q1"' })
    const first = await handleFeedRequest('posts', 'rss')
    expect(first.headers.get('X-Cache')).toBe('MISS')
    expect(await first.text()).toContain('First')

    // Same collection ETag: the cached body, even though these items would render differently.
    mockFetchFeedItems.mockResolvedValue({ items: [post('Ignored')], etag: '"q1"' })
    const second = await handleFeedRequest('posts', 'rss')
    expect(second.headers.get('X-Cache')).toBe('HIT')
    expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'))
    expect(await second.text()).toContain('First')
    expect(mockFetchFeedItems).toHaveBeenCalledTimes(2)

    const notModified = await handleFeedRequest('posts', 'rss', first.headers.get('ETag'))
    expect(notModified.status).toBe(304)

    mockFetchFeedItems.mockResolvedValue({ items: [post('Second')], etag: '"q2"' })
    const changed = await handleFeedRequest('posts', 'rss', first.headers.get('ETag'))
    expect(changed.status).toBe(200)
    expect(changed.headers.get('ETag')).not.toBe(first.headers.get('ETag'))
    expect(await changed.text()).toContain('Second')
  })

  it('keeps the ETag across a rebuild after the content TTL for an unchanged collection', async () => {
    mockFetchFeedItems.mockResolvedValue({ items: [post('First')], etag: '"q1"' })
    const first = await handleFeedRequest('posts', 'rss')

    vi.setSystemTime(new Date('2026-10-22T14:00:00Z'))
    const rebuilt = await handleFeedRequest('posts', 'rss', first.headers.get('ETag'))
    expect(rebuilt.status).toBe(304)
  })

  it('does not serve one site config\'s cached body to another', async () => {
    mockFetchFeedItems.mockResolvedValue({ items: [post('First')], etag: '"q1"' })
    await handleFeedRequest('posts', 'rss', null, undefined, 1, { title: 'Site A' })
    const other = await handleFeedRequest('posts', 'rss', null, undefined, 1, { title: 'Site B' })
    expect(other.headers.get('X-Cache')).toBe('MISS')
    expect(await other.text()).toContain('Site B')
  })

  it('serves an archive from cache without asking query, and its last body when a rebuild fails', async () => {
    mockGetMonthItems.mockResolvedValue([post('September')])
    const first = await handleArchiveFeedRequest('posts', 2026, 9, 'rss')
    expect(first.headers.get('X-Cache')).toBe('MISS')
    const hit = await handleArchiveFeedRequest('posts', 2026, 9, 'rss')
    expect(hit.headers.get('X-Cache')).toBe('HIT')
    expect(mockGetMonthItems).toHaveBeenCalledTimes(1)

    mockFetchFeedItems.mockResolvedValueOnce({ items: [post('First')], etag: '"q1"' })
    await handleFeedRequest('posts', 'rss')
    mockFetchFeedItems.mockRejectedValueOnce(new Error('indexer down'))
    const stale = await handleFeedRequest('posts', 'rss')
    expect(stale.status).toBe(200)
    expect(stale.headers.get('X-Cache')).toBe('STALE')
    expect(await stale.text()).toContain('First')
  })

  it('serves the stale body only to the site it was built for', async () => {
    mockFetchFeedItems.mockResolvedValueOnce({ items: [post('First')], etag: '"q1"' })
    await handleFeedRequest('posts', 'rss', null, undefined, 1, { title: 'Site A' })

    mockFetchFeedItems.mockRejectedValue(new Error('indexer down'))
    const other = await handleFeedRequest('posts', 'rss', null, undefined, 1, { title: 'Site B' })
    expect(other.status).toBe(500)

    const same = await handleFeedRequest('posts', 'rss', null, undefined, 1, { title: 'Site A' })
    expect(same.headers.get('X-Cache')).toBe('STALE')
    expect(await same.text()).toContain('Site A')
  })

  it('answers a weak If-None-Match for the current body with 304', async () => {
    mockFetchFeedItems.mockResolvedValue({ items: [post('First')], etag: '"q1"' })
    const first = await handleFeedRequest('posts', 'rss')
    const notModified = await handleFeedRequest('posts', 'rss', `W/${first.headers.get('ETag')}`)
    expect(notModified.status).toBe(304)
  })

  it('returns 400 for a NaN archive year or month without reading items', async () => {
    const badYear = await handleArchiveFeedRequest('posts', Number.NaN, 9, 'rss')
    const badMonth = await handleArchiveFeedRequest('posts', 2026, Number('x'), 'rss')
    expect(badYear.status).toBe(400)
    expect(badMonth.status).toBe(400)
    expect(mockGetMonthItems).not.toHaveBeenCalled()
  })
})
