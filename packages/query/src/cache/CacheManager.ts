import { generateCollectionETag, generateItemETag } from './etag.js'
import { MemoryCache } from './MemoryCache.js'
import type {
  CachedCollectionData,
  CachedItemData,
  PersistentCache,
  QueryCacheConfig,
  QueryCacheStats,
} from './types.js'
import type { GetSeedResult } from '../types.js'

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
 * Entries written before change tracking (or by another version) lack its bookkeeping and can't
 * be checked for changes, so they are treated as misses.
 */
function isCurrentCollection(data: unknown): data is CachedCollectionData {
  const d = data as Partial<CachedCollectionData> | null
  return (
    !!d &&
    Array.isArray(d.items) &&
    typeof d.meta === 'object' &&
    d.meta !== null &&
    typeof d.checkedAt === 'number' &&
    Array.isArray(d.seenChangeKeys)
  )
}

function isCurrentItem(data: unknown): data is CachedItemData {
  const d = data as Partial<CachedItemData> | null
  return (
    !!d &&
    !!d.record &&
    !!d.dependencies &&
    typeof d.checkedAt === 'number' &&
    Array.isArray(d.seenChangeKeys)
  )
}

/**
 * Unified query cache: memory, with optional persistent (disk) layer.
 * Collections are kept per schema and assemble-options key.
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
    optionsKey: string,
  ): Promise<CachedCollectionData | null> {
    if (!this.config.enabled) return null

    try {
      let cached = this.memoryCache.getCollection(schemaName, optionsKey)
      if (cached) {
        this.stats.hits++
        return cached
      }

      const persisted = (await this.persistent?.getCollection(schemaName, optionsKey)) ?? null
      if (isCurrentCollection(persisted)) {
        this.memoryCache.setCollection(schemaName, optionsKey, persisted)
        this.stats.hits++
        return persisted
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

  /** Stores a collection; its ETag is derived from the records' content. */
  async setCollection(
    schemaName: string,
    optionsKey: string,
    data: Omit<CachedCollectionData, 'etag'>,
  ): Promise<CachedCollectionData | null> {
    if (!this.config.enabled) return null

    try {
      const items = data.items.map((r) => ({ ...r, data: { ...r.data } }))
      const etag = generateCollectionETag(
        schemaName,
        optionsKey,
        items.map((r) => generateItemETag(r, optionsKey)),
      )
      const cached: CachedCollectionData = { ...data, items, etag }
      this.memoryCache.setCollection(schemaName, optionsKey, cached)
      await this.persistent?.setCollection(schemaName, optionsKey, cached)
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

      const persisted = (await this.persistent?.getItem(seedUid, optionsKey)) ?? null
      if (isCurrentItem(persisted)) {
        this.memoryCache.setItem(persisted)
        this.stats.hits++
        return persisted
      }

      this.stats.misses++
      return null
    } catch (error) {
      console.error(`Error getting query item cache for ${seedUid}:`, error)
      this.stats.errors++
      return null
    }
  }

  /** Stores an item; its ETag is derived from the record's content. */
  async setItem(
    data: Omit<CachedItemData, 'etag'>,
  ): Promise<CachedItemData | null> {
    if (!this.config.enabled) return null

    try {
      const record: GetSeedResult = {
        ...data.record,
        data: { ...data.record.data },
        ...(data.record.changelog && { changelog: [...data.record.changelog] }),
      }
      const cached: CachedItemData = {
        ...data,
        record,
        etag: generateItemETag(record, data.optionsKey),
      }
      this.memoryCache.setItem(cached)
      await this.persistent?.setItem(cached)
      return cached
    } catch (error) {
      console.error(
        `Error setting query item cache for ${data.record.seedUid}:`,
        error,
      )
      this.stats.errors++
      return null
    }
  }

  async writeThroughItems(items: Array<Omit<CachedItemData, 'etag'>>): Promise<void> {
    if (!this.config.enabled) return
    for (const item of items) {
      await this.setItem(item)
    }
  }

  async clearItem(seedUid: string, optionsKey: string): Promise<void> {
    this.memoryCache.clearItem(seedUid, optionsKey)
    await this.persistent?.clearItem(seedUid, optionsKey)
  }

  /** Every options variant of the schema's collection. */
  async clearCollection(schemaName: string): Promise<void> {
    this.memoryCache.clearCollection(schemaName)
    await this.persistent?.clearCollection(schemaName)
  }

  async clearAll(): Promise<void> {
    this.memoryCache.clearAll()
    await this.persistent?.clearAll()
  }

  async withRefreshLock<T>(
    key: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    return this.memoryCache.withRefreshLock(key, fn)
  }

  /** Counts a cache hit that was checked against changes and refreshed in part. */
  recordRefresh(): void {
    this.stats.refreshes++
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
