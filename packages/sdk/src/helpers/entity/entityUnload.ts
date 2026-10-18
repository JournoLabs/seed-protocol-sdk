import { CacheEntry } from './entityCache'
import type { InstanceStateStore } from './entityState'

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
   * Instance state store
   * Used to clean up liveQuery subscriptions (liveQuerySubscription, schemaLiveQuerySubscription, etc.)
   */
  instanceState: InstanceStateStore<T, {
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
 * Release one reference to a cached entity instance. When none remain, remove it from the
 * caches, clean up its subscriptions and stop its service
 * 
 * @param instance - Entity instance to unload
 * @param config - Unload configuration
 */
export function unloadEntity<T extends object>(instance: T, config: UnloadConfig<T>): void {
  // Get cache keys for this instance
  const cacheKeys = config.getCacheKeys(instance)

  // Release one hold per entry. An entry stored under several keys (a name and an id) is one
  // instance's count: decrement it once, and when it reaches 0 delete every key that holds it.
  const found: Array<{ cache: Map<string, CacheEntry<T>>; key: string; entry: CacheEntry<T> }> = []
  for (const cache of config.caches) {
    for (const key of cacheKeys) {
      const entry = cache.get(key)
      if (entry) found.push({ cache, key, entry })
    }
  }
  const entries = new Set(found.map(({ entry }) => entry))
  for (const entry of entries) entry.refCount -= 1

  let stillReferenced = false
  for (const { cache, key, entry } of found) {
    if (entry.refCount > 0) {
      stillReferenced = true
      continue
    }
    cache.delete(key)
    // Also remove from secondary caches if provided
    if (config.secondaryCaches) {
      for (const secondaryCache of config.secondaryCaches) {
        secondaryCache.delete(key)
      }
    }
  }

  // Other holders (e.g. another hook that created the same cached instance) still use it:
  // keep its subscriptions and service running. Stopping here broke them.
  if (stillReferenced) return

  // Clean up liveQuery subscriptions
  const instanceState = config.instanceState.get(instance)
  if (instanceState) {
    for (const key of ['liveQuerySubscription', 'schemaLiveQuerySubscription'] as const) {
      const sub = instanceState[key]
      if (sub?.unsubscribe) {
        try {
          sub.unsubscribe()
          ;(instanceState as Record<string, unknown>)[key] = null
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }

  // Call additional cleanup if provided
  if (config.onUnload) {
    try {
      config.onUnload(instance)
    } catch {
      // Ignore errors during cleanup
    }
  }
  
  // Stop the service
  try {
    const service = config.getService(instance)
    service.stop()
  } catch {
    // Ignore errors if service is already stopped
  }
}
