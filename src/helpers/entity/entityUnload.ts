import { CacheEntry } from './entityCache'

/**
 * Configuration for entity unload operations
 */
export interface UnloadConfig<T extends object> {
  /**
   * Get cache key(s) for this instance
   * Returns array of cache keys that should be removed/updated
   */
  getCacheKeys: (instance: T) => string[]
  /**
   * Static cache(s) to update
   * Multiple caches can be provided (e.g., ID cache and name cache)
   */
  caches: Map<string, CacheEntry<T>>[]
  /**
   * Optional secondary caches (name → id mappings)
   * These will be cleaned up if the primary cache entry is removed
   */
  secondaryCaches?: Map<string, string>[]
  /**
   * Instance state WeakMap
   * Used to clean up liveQuery subscriptions (liveQuerySubscription, schemaLiveQuerySubscription, etc.)
   */
  instanceState: WeakMap<T, {
    liveQuerySubscription?: { unsubscribe: () => void } | null
    schemaLiveQuerySubscription?: { unsubscribe: () => void } | null
    [key: string]: unknown
  }>
  /**
   * Get service from instance
   * Service will be stopped during unload
   */
  getService: (instance: T) => { stop: () => void }
  /**
   * Optional: Additional cleanup logic
   * Called after subscriptions are cleaned up but before service is stopped
   */
  onUnload?: (instance: T) => void
}

/**
 * Unload an entity instance and clean up all resources
 * 
 * @param instance - Entity instance to unload
 * @param config - Unload configuration
 */
export function unloadEntity<T extends object>(instance: T, config: UnloadConfig<T>): void {
  // Clean up liveQuery subscriptions
  const instanceState = config.instanceState.get(instance)
  if (instanceState) {
    for (const key of ['liveQuerySubscription', 'schemaLiveQuerySubscription'] as const) {
      const sub = instanceState[key]
      if (sub?.unsubscribe) {
        try {
          sub.unsubscribe()
          ;(instanceState as Record<string, unknown>)[key] = null
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    }
  }
  
  // Get cache keys for this instance
  const cacheKeys = config.getCacheKeys(instance)
  
  // Remove from all caches (decrement refCount, delete if 0)
  for (const cache of config.caches) {
    for (const key of cacheKeys) {
      const entry = cache.get(key)
      if (entry) {
        entry.refCount -= 1
        if (entry.refCount <= 0) {
          cache.delete(key)
          
          // Also remove from secondary caches if provided
          if (config.secondaryCaches) {
            for (const secondaryCache of config.secondaryCaches) {
              secondaryCache.delete(key)
            }
          }
        } else {
          cache.set(key, entry)
        }
      }
    }
  }
  
  // Call additional cleanup if provided
  if (config.onUnload) {
    try {
      config.onUnload(instance)
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
  
  // Stop the service
  try {
    const service = config.getService(instance)
    service.stop()
  } catch (error) {
    // Ignore errors if service is already stopped
  }
}
