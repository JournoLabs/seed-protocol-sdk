import type {
  CachedCollectionData,
  CachedItemData,
  QueryCacheConfig,
} from './types.js'

/**
 * In-memory collection + item cache with TTL and refresh locks.
 * Entries expire `ttl` seconds after their `lastUpdated` (their last full assembly).
 */
export class MemoryCache {
  private collectionCache: Map<string, CachedCollectionData> = new Map()
  private itemCache: Map<string, CachedItemData> = new Map()
  private config: QueryCacheConfig
  private refreshLocks: Map<string, Promise<unknown>> = new Map()

  constructor(config: QueryCacheConfig) {
    this.config = config
  }

  private collectionKey(schemaName: string, optionsKey: string): string {
    return `${schemaName}\n${optionsKey}`
  }

  private itemKey(seedUid: string, optionsKey: string): string {
    return `${seedUid}:${optionsKey}`
  }

  private expired(lastUpdated: number): boolean {
    return Math.floor(Date.now() / 1000) - lastUpdated > this.config.ttl
  }

  getCollection(schemaName: string, optionsKey: string): CachedCollectionData | null {
    const key = this.collectionKey(schemaName, optionsKey)
    const cached = this.collectionCache.get(key)
    if (!cached) return null
    if (this.expired(cached.lastUpdated)) {
      this.collectionCache.delete(key)
      return null
    }
    return cached
  }

  setCollection(schemaName: string, optionsKey: string, data: CachedCollectionData): void {
    this.collectionCache.set(this.collectionKey(schemaName, optionsKey), data)
  }

  getItem(seedUid: string, optionsKey: string): CachedItemData | null {
    const key = this.itemKey(seedUid, optionsKey)
    const cached = this.itemCache.get(key)
    if (!cached) return null
    if (this.expired(cached.lastUpdated)) {
      this.itemCache.delete(key)
      return null
    }
    return cached
  }

  setItem(data: CachedItemData): void {
    this.itemCache.set(this.itemKey(data.record.seedUid, data.optionsKey), data)
  }

  /** Every options variant of the schema's collection. */
  clearCollection(schemaName: string): void {
    for (const key of this.collectionCache.keys()) {
      if (key.startsWith(`${schemaName}\n`)) this.collectionCache.delete(key)
    }
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
   * Single-flight: concurrent callers with the same key share one in-flight promise.
   */
  async withRefreshLock<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const existingLock = this.refreshLocks.get(key)
    if (existingLock) {
      return existingLock as Promise<T>
    }

    const lockPromise = (async () => {
      try {
        return await fn()
      } finally {
        this.refreshLocks.delete(key)
      }
    })()

    this.refreshLocks.set(key, lockPromise)
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
