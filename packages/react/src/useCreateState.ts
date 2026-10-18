import { useCallback, useEffect, useRef, useState } from 'react'

type CreatedSnapshot = { value: unknown; context: unknown }

/** An entity a create hook returns: Schema, Model or ModelProperty. */
type CreatedEntity = {
  getService(): {
    getSnapshot(): CreatedSnapshot
    subscribe(listener: (snapshot: CreatedSnapshot) => void): { unsubscribe(): void }
  }
}

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

/**
 * Loading and error state for a create hook. `run(create)` sets `isLoading`, calls `create`, then
 * follows the returned entity's service until it is idle or in error. The current snapshot is read
 * right after subscribing, so an entity that was already loaded (no further state change) clears
 * `isLoading` at once. A throw or rejection from `create` clears it, sets `error` and is rethrown.
 */
export function useCreateState(failureMessage: string) {
  const subscriptionRef = useRef<{ unsubscribe(): void } | null>(null)
  // Bumped by each run and on unmount, so a superseded async create doesn't take over the state.
  const runIdRef = useRef(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const resetError = useCallback(() => setError(null), [])

  const follow = useCallback(
    (entity: CreatedEntity) => {
      const apply = (snapshot: CreatedSnapshot) => {
        if (snapshot.value === 'error') {
          const err = (snapshot.context as { _loadingError?: { error?: unknown } })?._loadingError?.error
          setError(err instanceof Error ? err : new Error(failureMessage))
          setIsLoading(false)
        } else if (snapshot.value === 'idle') {
          setError(null)
          setIsLoading(false)
        }
      }
      const service = entity.getService()
      subscriptionRef.current = service.subscribe(apply)
      apply(service.getSnapshot())
    },
    [failureMessage],
  )

  const fail = useCallback((err: unknown): never => {
    setError(toError(err))
    setIsLoading(false)
    throw err
  }, [])

  const start = useCallback(() => {
    subscriptionRef.current?.unsubscribe()
    subscriptionRef.current = null
    setError(null)
    setIsLoading(true)
    return ++runIdRef.current
  }, [])

  /** For a synchronous SDK create. */
  const run = useCallback(
    <T extends CreatedEntity>(create: () => T): T => {
      start()
      let entity: T
      try {
        entity = create()
      } catch (err) {
        return fail(err)
      }
      follow(entity)
      return entity
    },
    [start, fail, follow],
  )

  /** For a create that has to await something first. */
  const runAsync = useCallback(
    async <T extends CreatedEntity>(create: () => Promise<T>): Promise<T> => {
      const runId = start()
      let entity: T
      try {
        entity = await create()
      } catch (err) {
        if (runId !== runIdRef.current) throw err
        return fail(err)
      }
      if (runId === runIdRef.current) follow(entity)
      return entity
    },
    [start, fail, follow],
  )

  useEffect(() => {
    return () => {
      runIdRef.current++
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = null
    }
  }, [])

  return { run, runAsync, isLoading, error, resetError }
}
