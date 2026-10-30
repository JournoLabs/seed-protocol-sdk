import { useEffect } from 'react'

/** An entity instance a hook shows: Item, ItemProperty, Schema, Model or ModelProperty. */
type HeldEntity = {
  unload(): void
  getService(): { subscribe(observer: { complete?: () => void }): { unsubscribe(): void } }
}

/**
 * Holds each instance while the component shows it, with `retain` (the class's `retain`, which
 * takes a hold on a cached, running instance). The release is deferred a tick: a StrictMode
 * remount or a refetch returning the same instances takes its new holds before the old ones are
 * dropped, so a count never touches 0 in between. The cache's grace period covers that too, but an
 * app may configure it to 0. `onStopped` runs when an instance can't be held, and when a held one
 * stops (destroyed, evicted, dropped by another tab), so the hook looks it up again.
 *
 * `retain` and `onStopped` should be stable (module-level, or from useCallback).
 */
export function useHeldEntities<T extends HeldEntity>(
  instances: readonly T[],
  retain: (instance: T) => boolean,
  onStopped: () => void,
): void {
  useEffect(() => {
    const held = instances.filter((instance) => retain(instance))
    if (held.length < instances.length) onStopped()
    let reported = false
    // An actor's observers complete when it stops
    const subscriptions = held.map((instance) =>
      instance.getService().subscribe({
        complete: () => {
          if (reported) return
          reported = true
          onStopped()
        },
      }),
    )
    return () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
      setTimeout(() => {
        for (const instance of held) instance.unload()
      }, 0)
    }
  }, [instances, retain, onStopped])
}
