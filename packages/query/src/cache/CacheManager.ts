import type { GetSeedResult, SeedRecord } from '../types.js'
import { MemoryCache } from './MemoryCache.js'
import type {
  CachedCollectionData,
  CachedItemData,
  PersistentCache,
  QueryCacheConfig,
  QueryCacheStats,
} from './types.js'

type PersistentCacheFactory = (config: QueryCacheConfig) => PersistentCache | null

let persistentCacheFactory: PersistentCacheFactory = () => null

/**
 * Node entry (`index.node.ts`) registers FileCache here so the browser
 * graph never statically imports `fs` / `path`.
 */
export function configurePersistentCacheFactory(
  factory: PersistentCacheFactory,
): void {
  persistentCacheFactory = factory
}

/**
 * Unified query cache: memory, with optional persistent (disk) layer.
 */
export class CacheManager {
  private memoryCache: MemoryCache
  private persistent: PersistentCache | null
  private config: QueryCacheConfig
  private stats: QueryCacheStats = {
    hits: 0,
    misses: 0,
    refreshes: 0,
    errors: 0,
  }

  constructor(config: QueryCacheConfig, persistent?: PersistentCache | null) {
    this.config = config
    this.memoryCache = new MemoryCache(config)
    if (persistent === undefined) {
      this.persistent = persistentCacheFactory(config)
    } else {
      this.persistent = persistent
    }
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  getConfig(): QueryCacheConfig {
    return { ...this.config }
  }

  async getCollection(
    schemaName: string,
  ): Promise<CachedCollectionData | null> {
    if (!this.config.enabled) return null

    try {
      let cached = this.memoryCache.getCollection(schemaName)
      if (cached) {
        this.stats.hits++
        return cached
      }

      cached = (await this.persistent?.getCollection(schemaName)) ?? null
      if (cached) {
        this.memoryCache.setCollection(schemaName, cached.items)
        this.stats.hits++
        return cached
      }

      this.stats.misses++
      return null
    } catch (error) {
      console.error(
        `Error getting query collection cache for ${schemaName}:`,
        error,
      )
      this.stats.errors++
      return null
    }
  }

  async setCollection(
    schemaName: string,
    items: SeedRecord[],
  ): Promise<CachedCollectionData | null> {
    if (!this.config.enabled) return null

    try {
      const cached = this.memoryCache.setCollection(schemaName, items)
      await this.persistent?.setCollection(schemaName, cached)
      return cached
    } catch (error) {
      console.error(
        `Error setting query collection cache for ${schemaName}:`,
        error,
      )
      this.stats.errors++
      return null
    }
  }

  async getItem(
    seedUid: string,
    optionsKey: string,
  ): Promise<CachedItemData | null> {
    if (!this.config.enabled) return null

    try {
      let cached = this.memoryCache.getItem(seedUid, optionsKey)
      if (cached) {
        this.stats.hits++
        return cached
      }

      cached = (await this.persistent?.getItem(seedUid, optionsKey)) ?? null
      if (cached) {
        this.memoryCache.setItem(cached.record, optionsKey)
        this.stats.hits++
        return cached
      }

      this.stats.misses++
      return null
    } catch (error) {
      console.error(`Error getting query item cache for ${seedUid}:`, error)
      this.stats.errors++
      return null
    }
  }

  async setItem(
    record: GetSeedResult,
    optionsKey: string,
  ): Promise<CachedItemData | null> {
    if (!this.config.enabled) return null

    try {
      const cached = this.memoryCache.setItem(record, optionsKey)
      await this.persistent?.setItem(cached)
      return cached
    } catch (error) {
      console.error(
        `Error setting query item cache for ${record.seedUid}:`,
        error,
      )
      this.stats.errors++
      return null
    }
  }

  async writeThroughItems(
    items: SeedRecord[],
    optionsKey: string,
  ): Promise<void> {
    if (!this.config.enabled) return
    for (const item of items) {
      await this.setItem(item, optionsKey)
    }
  }

  async clearCollection(schemaName: string): Promise<void> {
    this.memoryCache.clearCollection(schemaName)
    await this.persistent?.clearCollection(schemaName)
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clearAll()
    await this.persistent?.clearAll()
  }

  async withRefreshLock<T>(
    schemaName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.memoryCache.withRefreshLock(schemaName, fn)
  }

  /**
   * Merge records by seedUid; new wins. Sort by timeCreated descending.
   */
  mergeRecords(
    cachedItems: SeedRecord[],
    newItems: SeedRecord[],
  ): SeedRecord[] {
    const itemMap = new Map<string, SeedRecord>()

    for (const item of cachedItems) {
      if (item.seedUid) itemMap.set(item.seedUid, item)
    }
    for (const item of newItems) {
      if (item.seedUid) {
        itemMap.set(item.seedUid, item)
      } else {
        itemMap.set(`temp-${Date.now()}-${Math.random()}`, item)
      }
    }

    const merged = Array.from(itemMap.values())
    merged.sort((a, b) => (b.timeCreated || 0) - (a.timeCreated || 0))
    return merged
  }

  /**
   * Keep only records newer than lastProcessedTimestamp.
   */
  filterNewRecords(
    items: SeedRecord[],
    lastProcessedTimestamp: number,
  ): SeedRecord[] {
    return items.filter(
      (item) => item.timeCreated && item.timeCreated > lastProcessedTimestamp,
    )
  }

  updateConfig(config: Partial<QueryCacheConfig>): void {
    this.config = { ...this.config, ...config }
    this.memoryCache.updateConfig(this.config)
  }

  getStats(): QueryCacheStats & {
    memoryStats: ReturnType<MemoryCache['getStats']>
  } {
    return {
      ...this.stats,
      memoryStats: this.memoryCache.getStats(),
    }
  }

  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      refreshes: 0,
      errors: 0,
    }
  }
}
