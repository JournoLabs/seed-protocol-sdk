/**
 * Generic caching utilities for entity classes
 * Provides refCount tracking and cache management
 */

/**
 * Cache entry with reference counting
 */
export interface CacheEntry<T> {
  instance: T
  refCount: number
}

/**
 * Configuration for cache operations
 */
export interface CacheConfig<T> {
  /**
   * Get cache key from instance
   */
  getCacheKey: (instance: T) => string | undefined
  /**
   * Get cache key from lookup parameters
   */
  getCacheKeyFromParams: (params: any) => string | undefined
  /**
   * Static cache map (provided by entity class)
   */
  cache: Map<string, CacheEntry<T>>
  /**
   * Optional secondary cache/index (e.g., name → id mapping)
   */
  secondaryCache?: Map<string, string>
}

/**
 * Get a cached instance and increment its refCount
 */
export function getCachedInstance<T>(config: CacheConfig<T>, key: string): T | undefined {
  const entry = config.cache.get(key)
  if (entry) {
    // Increment refCount
    config.cache.set(key, {
      instance: entry.instance,
      refCount: entry.refCount + 1,
    })
    return entry.instance
  }
  return undefined
}

/**
 * Add an instance to the cache with refCount tracking
 */
export function cacheInstance<T>(config: CacheConfig<T>, key: string, instance: T): void {
  const existing = config.cache.get(key)
  if (existing) {
    // Increment refCount if already exists
    config.cache.set(key, {
      instance: existing.instance,
      refCount: existing.refCount + 1,
    })
  } else {
    // Add new entry with refCount = 1
    config.cache.set(key, {
      instance,
      refCount: 1,
    })
  }
}

/**
 * Remove an instance from cache (decrement refCount, delete if 0)
 */
export function uncacheInstance<T>(config: CacheConfig<T>, key: string): void {
  const entry = config.cache.get(key)
  if (entry) {
    entry.refCount -= 1
    if (entry.refCount <= 0) {
      config.cache.delete(key)
    } else {
      config.cache.set(key, entry)
    }
  }
}

/**
 * Update secondary cache (e.g., name → id mapping)
 */
export function updateSecondaryCache<T>(
  config: CacheConfig<T>,
  oldKey: string | undefined,
  newKey: string,
  id: string
): void {
  if (config.secondaryCache) {
    if (oldKey) {
      config.secondaryCache.delete(oldKey)
    }
    config.secondaryCache.set(newKey, id)
  }
}
