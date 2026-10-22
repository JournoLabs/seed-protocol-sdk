import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CacheManager } from '../src/cache/CacheManager'
import type { CacheConfig } from '../src/cache/types'

describe('feed CacheManager', () => {
  let cacheDir: string
  let config: CacheConfig

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    cacheDir = mkdtempSync(join(tmpdir(), 'feed-cache-'))
    config = {
      enabled: true,
      ttl: 3600,
      cacheDir,
      pageTtl: 300,
      imageMetadata: { enabled: true, ttl: 604800, gateways: [], timeout: 1000 },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('keeps the ETag and expiry of an entry read back from disk', async () => {
    await new CacheManager(config).setFeedContent(
      'post',
      'rss',
      { content: '<rss/>', contentType: 'application/rss+xml', etag: '"abc"', fingerprint: 'f1' },
      { page: 2 },
    )
    const written = await new CacheManager(config).getFeedContent('post', 'rss', { page: 2 })

    vi.setSystemTime(new Date('2026-10-21T12:02:00Z'))
    // A fresh manager has an empty memory cache, so this read comes from disk.
    const restarted = new CacheManager(config)
    const fromDisk = await restarted.getFeedContent('post', 'rss', { page: 2 })
    const fromMemory = await restarted.getFeedContent('post', 'rss', { page: 2 })

    expect(fromDisk?.etag).toBe(written?.etag)
    expect(fromMemory?.etag).toBe(written?.etag)
    expect(fromMemory?.expiresAt).toBe(written?.expiresAt)
  })

  it('returns an entry for a fingerprint only when it was built with that fingerprint', async () => {
    const cache = new CacheManager(config)
    await cache.setFeedContent('post', 'rss', {
      content: '<rss/>',
      contentType: 'application/rss+xml',
      etag: '"abc"',
      fingerprint: 'f1',
    })
    expect(await cache.getFeedContent('post', 'rss', undefined, 'f1')).not.toBeNull()
    expect(await cache.getFeedContent('post', 'rss', undefined, 'f2')).toBeNull()
    expect(await cache.getFeedContent('post', 'rss')).not.toBeNull()
  })

  it('caches image metadata when content caching is off', async () => {
    const cache = new CacheManager({ ...config, enabled: false })
    await cache.setImageMetadata('tx1', { isImage: true, url: 'https://arweave.net/tx1' })
    expect(await cache.getImageMetadata('tx1')).toMatchObject({ isImage: true })
  })
})
