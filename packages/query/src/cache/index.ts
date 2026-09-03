import { CacheManager } from './CacheManager.js'
import { loadQueryCacheConfig } from './config.js'

export { CacheManager } from './CacheManager.js'
export { MemoryCache } from './MemoryCache.js'
export { FileCache } from './FileCache.js'
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
  QueryCacheConfig,
  QueryCacheStats,
} from './types.js'

let cacheManager: CacheManager | null = null

/**
 * Get the singleton query CacheManager (lazy-init from env).
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
 */
export function createQueryCacheManager(
  config?: Partial<ReturnType<typeof loadQueryCacheConfig>>,
): CacheManager {
  return new CacheManager({
    ...loadQueryCacheConfig(),
    ...config,
  })
}
