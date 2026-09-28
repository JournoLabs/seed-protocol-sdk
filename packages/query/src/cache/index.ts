import { CacheManager } from './CacheManager.js'
import { loadQueryCacheConfig } from './config.js'
import type { PersistentCache, QueryCacheConfig } from './types.js'

export { CacheManager, configurePersistentCacheFactory } from './CacheManager.js'
export { MemoryCache } from './MemoryCache.js'
export { loadQueryCacheConfig } from './config.js'
export {
  generateETag,
  generateCollectionETag,
  generateItemETag,
} from './etag.js'
export {
  buildAssembleOptionsKey,
  sanitizeSeedUidForPath,
} from './types.js'
export type {
  CachedCollectionData,
  CachedItemData,
  PersistentCache,
  QueryCacheConfig,
  QueryCacheStats,
} from './types.js'

let cacheManager: CacheManager | null = null

/**
 * Get the singleton query CacheManager (lazy-init from env).
 * Browser graphs are memory-only. Node `index.node` registers FileCache.
 */
export function getQueryCacheManager(): CacheManager {
  if (!cacheManager) {
    cacheManager = new CacheManager(loadQueryCacheConfig())
  }
  return cacheManager
}

/**
 * Reset singleton (tests / config reload).
 */
export function resetQueryCacheManager(): void {
  cacheManager = null
}

/**
 * Create a CacheManager with an explicit config (tests).
 * Pass a PersistentCache (e.g. FileCache) to enable the disk layer.
 */
export function createQueryCacheManager(
  config?: Partial<QueryCacheConfig>,
  persistent?: PersistentCache | null,
): CacheManager {
  return new CacheManager(
    {
      ...loadQueryCacheConfig(),
      ...config,
    },
    persistent,
  )
}
