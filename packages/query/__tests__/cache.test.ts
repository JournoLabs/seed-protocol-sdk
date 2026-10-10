import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createQueryCacheManager,
  resetQueryCacheManager,
  buildAssembleOptionsKey,
} from '../src/cache/index.js'
import { FileCache } from '../src/cache/FileCache.js'
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

const deps = (seedUid: string) => ({ refUIDs: [seedUid, `v-${seedUid}`], ids: [seedUid] })

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
    const config = {
      enabled: true,
      ttl: 3600,
      cacheDir,
    }
    cache = createQueryCacheManager(config, new FileCache({
      ...config,
      backgroundRefresh: false,
      refreshInterval: 300,
    }))
  })

  afterEach(async () => {
    await cache.clearAll()
    resetQueryCacheManager()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  const KEY = buildAssembleOptionsKey()

  const collection = (items: SeedRecord[], lastUpdated = Math.floor(Date.now() / 1000)) => ({
    items,
    meta: Object.fromEntries(
      items.map((r) => [r.seedUid, { dependencies: deps(r.seedUid), builtAt: lastUpdated }]),
    ),
    checkedAt: lastUpdated - 600,
    seenChangeKeys: [],
    lastUpdated,
  })

  const item = (record: SeedRecord, optionsKey = KEY) => ({
    record,
    optionsKey,
    dependencies: deps(record.seedUid),
    checkedAt: 0,
    seenChangeKeys: [],
    lastUpdated: Math.floor(Date.now() / 1000),
  })

  it('stores and retrieves a collection per options key, with a content etag', async () => {
    const items = [makeRecord('0xa', 100), makeRecord('0xb', 200)]
    const stored = await cache.setCollection('post', KEY, collection(items))
    expect(stored?.etag).toMatch(/^"[a-f0-9]{16}"$/)

    const got = await cache.getCollection('post', KEY)
    expect(got?.items).toHaveLength(2)
    expect(got?.etag).toBe(stored?.etag)
    expect(got?.meta['0xa']?.dependencies).toEqual(deps('0xa'))
    expect(await cache.getCollection('post', buildAssembleOptionsKey({ hydrateStorage: false }))).toBeNull()
  })

  it('collection etag changes when a record changes without a new versionUid', async () => {
    const before = await cache.setCollection('post', KEY, collection([makeRecord('0xa', 100)]))
    const after = await cache.setCollection(
      'post',
      KEY,
      collection([makeRecord('0xa', 100, { data: { title: 'patched' } })]),
    )
    expect(after?.etag).not.toBe(before?.etag)
  })

  it('item etag ignores key order', async () => {
    const a = await cache.setItem(item(makeRecord('0xa', 1, { data: { x: 1, y: { p: 1, q: 2 } } })))
    const b = await cache.setItem(item(makeRecord('0xa', 1, { data: { y: { q: 2, p: 1 }, x: 1 } })))
    expect(a?.etag).toBe(b?.etag)
  })

  it('reads the collection back from disk in a new manager', async () => {
    await cache.setCollection('post', KEY, collection([makeRecord('0xa', 100)]))
    const config = { enabled: true, ttl: 3600, cacheDir, backgroundRefresh: false, refreshInterval: 300 }
    const fresh = createQueryCacheManager(config, new FileCache(config))
    expect((await fresh.getCollection('post', KEY))?.items[0]?.seedUid).toBe('0xa')
  })

  it('treats a collection file from before change tracking as a miss', async () => {
    const config = { enabled: true, ttl: 3600, cacheDir, backgroundRefresh: false, refreshInterval: 300 }
    const files = new FileCache(config)
    await files.setCollection('post', KEY, {
      items: [makeRecord('0xa', 100)],
      lastProcessedTimestamp: 100,
      lastUpdated: Math.floor(Date.now() / 1000),
      etag: '"x"',
    } as never)
    expect(await createQueryCacheManager(config, files).getCollection('post', KEY)).toBeNull()
  })

  it('expires collection TTL seconds after its last full assembly', async () => {
    const shortConfig = {
      enabled: true,
      ttl: 1,
      cacheDir,
      backgroundRefresh: false,
      refreshInterval: 300,
    }
    const short = createQueryCacheManager(shortConfig, new FileCache(shortConfig))
    await short.setCollection('post', KEY, collection([makeRecord('0xa', 100)]))
    expect(await short.getCollection('post', KEY)).not.toBeNull()

    vi.useFakeTimers()
    const nowSec = Math.floor(Date.now() / 1000)
    vi.setSystemTime((nowSec + 5) * 1000)
    expect(await short.getCollection('post', KEY)).toBeNull()
    vi.useRealTimers()
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

  it('stores, retrieves and clears items by options key', async () => {
    const record = makeRecord('0xseed', 123)
    await cache.setItem(item(record))
    const got = await cache.getItem('0xseed', KEY)
    expect(got?.record.seedUid).toBe('0xseed')
    expect(got?.optionsKey).toBe(KEY)
    expect(got?.dependencies).toEqual(deps('0xseed'))

    const otherKey = buildAssembleOptionsKey({ expandRelations: false })
    expect(await cache.getItem('0xseed', otherKey)).toBeNull()

    await cache.clearItem('0xseed', KEY)
    expect(await cache.getItem('0xseed', KEY)).toBeNull()
  })

  it('writeThroughItems populates item cache', async () => {
    await cache.writeThroughItems([item(makeRecord('0x1', 1)), item(makeRecord('0x2', 2))])
    expect((await cache.getItem('0x1', KEY))?.record.seedUid).toBe('0x1')
    expect((await cache.getItem('0x2', KEY))?.record.seedUid).toBe('0x2')
  })

  it('returns null when disabled', async () => {
    const disabled = createQueryCacheManager({
      enabled: false,
      ttl: 3600,
      cacheDir,
    })
    await disabled.setCollection('post', KEY, collection([makeRecord('0xa', 1)]))
    expect(await disabled.getCollection('post', KEY)).toBeNull()
  })

  it('memory-only manager still stores collections without FileCache', async () => {
    const memoryOnly = createQueryCacheManager(
      { enabled: true, ttl: 3600, cacheDir },
      null,
    )
    await memoryOnly.setCollection('post', KEY, collection([makeRecord('0xa', 100)]))
    expect(await memoryOnly.getCollection('post', KEY)).not.toBeNull()
  })
})
