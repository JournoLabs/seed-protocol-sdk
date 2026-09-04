import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createQueryCacheManager,
  resetQueryCacheManager,
  buildAssembleOptionsKey,
} from '../src/cache/index.js'
import type { CacheManager } from '../src/cache/CacheManager.js'
import type { SeedRecord } from '../src/types.js'

function makeRecord(
  seedUid: string,
  timeCreated: number,
  extras?: Partial<SeedRecord>,
): SeedRecord {
  return {
    seedUid,
    schemaName: 'post',
    timeCreated,
    versionUid: `v-${seedUid}`,
    data: { title: seedUid },
    ...extras,
  }
}

describe('buildAssembleOptionsKey', () => {
  it('defaults expand+hydrate to true', () => {
    expect(buildAssembleOptionsKey()).toBe('e1-h1')
    expect(buildAssembleOptionsKey({})).toBe('e1-h1')
  })

  it('encodes false flags', () => {
    expect(
      buildAssembleOptionsKey({ expandRelations: false, hydrateStorage: false }),
    ).toBe('e0-h0')
  })

  it('isolates changelog include from default key', () => {
    expect(buildAssembleOptionsKey({ include: 'data+changelog' })).toBe(
      'e1-h1-i1-gv-s0-l0',
    )
  })
})

describe('CacheManager collection + item', () => {
  let cacheDir: string
  let cache: CacheManager

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'query-cache-'))
    cache = createQueryCacheManager({
      enabled: true,
      ttl: 3600,
      cacheDir,
    })
  })

  afterEach(async () => {
    await cache.clearAll()
    resetQueryCacheManager()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('stores and retrieves a collection with etag', async () => {
    const items = [makeRecord('0xa', 100), makeRecord('0xb', 200)]
    const stored = await cache.setCollection('post', items)
    expect(stored?.etag).toMatch(/^"[a-f0-9]{16}"$/)
    expect(stored?.lastProcessedTimestamp).toBe(200)
    expect(stored?.lastProcessedItemId).toBe('0xb')

    const got = await cache.getCollection('post')
    expect(got?.items).toHaveLength(2)
    expect(got?.etag).toBe(stored?.etag)
  })

  it('expires collection after TTL', async () => {
    const short = createQueryCacheManager({
      enabled: true,
      ttl: 1,
      cacheDir,
    })
    await short.setCollection('post', [makeRecord('0xa', 100)])
    expect(await short.getCollection('post')).not.toBeNull()

    vi.useFakeTimers()
    const nowSec = Math.floor(Date.now() / 1000)
    vi.setSystemTime((nowSec + 5) * 1000)
    expect(await short.getCollection('post')).toBeNull()
    vi.useRealTimers()
  })

  it('mergeRecords dedupes by seedUid and sorts by timeCreated desc', () => {
    const cached = [makeRecord('0xa', 100), makeRecord('0xb', 50)]
    const newer = [
      makeRecord('0xa', 300, { data: { title: 'updated' } }),
      makeRecord('0xc', 250),
    ]
    const merged = cache.mergeRecords(cached, newer)
    expect(merged.map((r) => r.seedUid)).toEqual(['0xa', '0xc', '0xb'])
    expect(merged[0].data.title).toBe('updated')
  })

  it('filterNewRecords keeps only newer than watermark', () => {
    const items = [
      makeRecord('0xa', 100),
      makeRecord('0xb', 200),
      makeRecord('0xc', 150),
    ]
    expect(cache.filterNewRecords(items, 150).map((r) => r.seedUid)).toEqual([
      '0xb',
    ])
  })

  it('withRefreshLock single-flights concurrent callers', async () => {
    let runs = 0
    const work = async () => {
      runs++
      await new Promise((r) => setTimeout(r, 50))
      return 'ok'
    }
    const [a, b, c] = await Promise.all([
      cache.withRefreshLock('post', work),
      cache.withRefreshLock('post', work),
      cache.withRefreshLock('post', work),
    ])
    expect(a).toBe('ok')
    expect(b).toBe('ok')
    expect(c).toBe('ok')
    expect(runs).toBe(1)
  })

  it('stores and retrieves items by options key', async () => {
    const record = makeRecord('0xseed', 123)
    const key = buildAssembleOptionsKey()
    await cache.setItem(record, key)
    const got = await cache.getItem('0xseed', key)
    expect(got?.record.seedUid).toBe('0xseed')
    expect(got?.optionsKey).toBe(key)

    const otherKey = buildAssembleOptionsKey({ expandRelations: false })
    expect(await cache.getItem('0xseed', otherKey)).toBeNull()
  })

  it('writeThroughItems populates item cache', async () => {
    const items = [makeRecord('0x1', 1), makeRecord('0x2', 2)]
    const key = buildAssembleOptionsKey()
    await cache.writeThroughItems(items, key)
    expect((await cache.getItem('0x1', key))?.record.seedUid).toBe('0x1')
    expect((await cache.getItem('0x2', key))?.record.seedUid).toBe('0x2')
  })

  it('returns null when disabled', async () => {
    const disabled = createQueryCacheManager({
      enabled: false,
      ttl: 3600,
      cacheDir,
    })
    await disabled.setCollection('post', [makeRecord('0xa', 1)])
    expect(await disabled.getCollection('post')).toBeNull()
  })
})
