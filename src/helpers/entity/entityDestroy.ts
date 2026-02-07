/**
 * Shared helpers for entity destroy operations.
 * Used by Schema, Model, ModelProperty, Item, and ItemProperty destroy() methods.
 */

export interface ClearDestroySubscriptionsConfig<T extends object> {
  instanceState: WeakMap<T, { liveQuerySubscription?: { unsubscribe: () => void } | null }>
  onUnload?: (instance: T) => void
}

/**
 * Unsubscribe liveQuery and any extra subscription (e.g. Item/ItemProperty _subscription).
 * Swallows errors so one failure doesn't block the rest.
 */
export function clearDestroySubscriptions<T extends object>(
  instance: T,
  config: ClearDestroySubscriptionsConfig<T>,
): void {
  const instanceState = config.instanceState.get(instance)
  if (instanceState?.liveQuerySubscription) {
    try {
      instanceState.liveQuerySubscription.unsubscribe()
      instanceState.liveQuerySubscription = null
    } catch {
      // Ignore errors during cleanup
    }
  }
  if (config.onUnload) {
    try {
      config.onUnload(instance)
    } catch {
      // Ignore errors during cleanup
    }
  }
}

export interface ForceRemoveFromCachesConfig<T extends object> {
  getCacheKeys: (instance: T) => string[]
  caches: Map<string, unknown>[]
  secondaryCaches?: Map<string, unknown>[]
}

/**
 * Remove the instance from all given caches by key, without refCount (always delete).
 * Works for both entry caches and index caches since the operation is only delete(key).
 */
export function forceRemoveFromCaches<T extends object>(
  instance: T,
  config: ForceRemoveFromCachesConfig<T>,
): void {
  const cacheKeys = config.getCacheKeys(instance)
  for (const cache of config.caches) {
    for (const key of cacheKeys) {
      cache.delete(key)
    }
  }
  if (config.secondaryCaches) {
    for (const secondaryCache of config.secondaryCaches) {
      for (const key of cacheKeys) {
        secondaryCache.delete(key)
      }
    }
  }
}

export interface RunDestroyLifecycleConfig<T extends object> {
  getService: (instance: T) => { send: (ev: unknown) => void; stop: () => void }
  doDestroy: () => Promise<void>
}

/**
 * Run the service event sequence and stop the service:
 * destroyStarted -> doDestroy -> destroyDone/destroyError -> stop.
 * Event names must match what the entity machines expect.
 */
export async function runDestroyLifecycle<T extends object>(
  instance: T,
  config: RunDestroyLifecycleConfig<T>,
): Promise<void> {
  const service = config.getService(instance)
  service.send({ type: 'destroyStarted' } as { type: string; error?: unknown })
  try {
    await config.doDestroy()
  } catch (error) {
    service.send({ type: 'destroyError', error } as { type: string; error?: unknown })
  } finally {
    service.send({ type: 'destroyDone' } as { type: string; error?: unknown })
    try {
      service.stop()
    } catch {
      // Service might already be stopped
    }
  }
}
