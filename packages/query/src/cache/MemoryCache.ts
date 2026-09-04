import type { GetSeedResult, SeedRecord } from '../types.js'
import { generateCollectionETag, generateItemETag } from './etag.js'
import type {
  CachedCollectionData,
  CachedItemData,
  QueryCacheConfig,
} from './types.js'

/**
 * In-memory collection + item cache with TTL and refresh locks.
 */
export class MemoryCache {
  private collectionCache: Map<string, CachedCollectionData> = new Map()
  private itemCache: Map<string, CachedItemData> = new Map()
  private config: QueryCacheConfig
  private refreshLocks: Map<string, Promise<unknown>> = new Map()

  constructor(config: QueryCacheConfig) {
    this.config = config
  }

  private itemKey(seedUid: string, optionsKey: string): string {
    return `${seedUid}:${optionsKey}`
  }

  getCollection(schemaName: string): CachedCollectionData | null {
    const cached = this.collectionCache.get(schemaName)
    if (!cached) return null

    const now = Math.floor(Date.now() / 1000)
    if (now - cached.lastUpdated > this.config.ttl) {
      this.collectionCache.delete(schemaName)
      return null
    }
    return cached
  }

  setCollection(schemaName: string, items: SeedRecord[]): CachedCollectionData {
    const now = Math.floor(Date.now() / 1000)
    let lastProcessedTimestamp = 0
    let lastProcessedItemId = ''

    for (const item of items) {
      if (item.timeCreated && item.timeCreated > lastProcessedTimestamp) {
        lastProcessedTimestamp = item.timeCreated
        lastProcessedItemId = item.seedUid
      }
    }
    if (lastProcessedTimestamp === 0) {
      lastProcessedTimestamp = now
    }

    const etag = generateCollectionETag(
      schemaName,
      lastProcessedTimestamp,
      items.length,
    )

    const cached: CachedCollectionData = {
      items: items.map((r) => ({ ...r, data: { ...r.data } })),
      lastProcessedTimestamp,
      lastProcessedItemId,
      lastUpdated: now,
      etag,
    }
    this.collectionCache.set(schemaName, cached)
    return cached
  }

  getItem(seedUid: string, optionsKey: string): CachedItemData | null {
    const cached = this.itemCache.get(this.itemKey(seedUid, optionsKey))
    if (!cached) return null

    const now = Math.floor(Date.now() / 1000)
    if (now - cached.lastUpdated > this.config.ttl) {
      this.itemCache.delete(this.itemKey(seedUid, optionsKey))
      return null
    }
    return cached
  }

  setItem(
    record: GetSeedResult,
    optionsKey: string,
  ): CachedItemData {
    const now = Math.floor(Date.now() / 1000)
    const etag = generateItemETag(
      record.seedUid,
      record.versionUid,
      record.timeCreated,
      optionsKey,
    )
    const cachedRecord: GetSeedResult = {
      ...record,
      data: { ...record.data },
    }
    if (record.changelog) {
      cachedRecord.changelog = [...record.changelog]
    }
    const cached: CachedItemData = {
      record: cachedRecord,
      lastUpdated: now,
      etag,
      optionsKey,
    }
    this.itemCache.set(this.itemKey(record.seedUid, optionsKey), cached)
    return cached
  }

  clearCollection(schemaName: string): void {
    this.collectionCache.delete(schemaName)
  }

  clearItem(seedUid: string, optionsKey?: string): void {
    if (optionsKey) {
      this.itemCache.delete(this.itemKey(seedUid, optionsKey))
      return
    }
    for (const key of this.itemCache.keys()) {
      if (key.startsWith(`${seedUid}:`)) {
        this.itemCache.delete(key)
      }
    }
  }

  clearAll(): void {
    this.collectionCache.clear()
    this.itemCache.clear()
  }

  /**
   * Single-flight: concurrent callers for the same schema share one in-flight promise.
   */
  async withRefreshLock<T>(
    schemaName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const existingLock = this.refreshLocks.get(schemaName)
    if (existingLock) {
      return existingLock as Promise<T>
    }

    const lockPromise = (async () => {
      try {
        return await fn()
      } finally {
        this.refreshLocks.delete(schemaName)
      }
    })()

    this.refreshLocks.set(schemaName, lockPromise)
    return lockPromise
  }

  updateConfig(config: Partial<QueryCacheConfig>): void {
    this.config = { ...this.config, ...config }
  }

  getStats(): {
    collectionCount: number
    itemCount: number
    activeLocks: number
  } {
    return {
      collectionCount: this.collectionCache.size,
      itemCount: this.itemCache.size,
      activeLocks: this.refreshLocks.size,
    }
  }
}
