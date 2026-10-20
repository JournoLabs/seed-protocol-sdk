import { useEffect, useState, useRef } from 'react'
import { BaseDb } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'

/**
 * Hook to execute a reactive query that emits new results whenever the underlying data changes.
 * 
 * Supports two usage patterns:
 * 1. SQL tag function: useLiveQuery((sql) => sql`SELECT * FROM models`)
 * 2. Drizzle query builder: useLiveQuery(db.select().from(models))
 * 
 * @param query - SQL query function or Drizzle query builder, or null/undefined to disable the query
 * @returns Array of query results, or undefined if not yet loaded
 * 
 * @example
 * ```typescript
 * // Using SQL tag function
 * const models = useLiveQuery<ModelRow>(
 *   (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
 * )
 * 
 * // Using Drizzle query builder
 * import { models } from '@seedprotocol/sdk'
 * import { eq } from 'drizzle-orm'
 * 
 * const appDb = BaseDb.getAppDb()
 * const models = useLiveQuery<ModelRow>(
 *   appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
 * )
 * ```
 */
export function useLiveQuery<T>(
  query: ((sql: any) => any) | any | null | undefined
): T[] | undefined {
  return useLiveQueryState<T>(query).data
}

/**
 * Identity of a query for subscription purposes. A Drizzle builder is identified by its compiled
 * SQL and parameters, so an inline (unmemoised) builder doesn't resubscribe on every render; that
 * re-render/resubscribe cycle looped. A SQL tag function can only be identified by reference:
 * memoise it (useCallback/useMemo).
 */
export function queryKeyOf(query: unknown): unknown {
  if (query && typeof query === 'object' && typeof (query as { toSQL?: unknown }).toSQL === 'function') {
    try {
      const { sql, params } = (query as { toSQL: () => { sql: string; params: unknown[] } }).toSQL()
      return `sql:${sql}|${JSON.stringify(params)}`
    } catch {
      return query
    }
  }
  return query
}

/** Delays before resubscribing after a live query fails, in ms; the last one repeats. */
export const LIVE_QUERY_RETRY_DELAYS_MS = [500, 1000, 2000, 5000, 10000, 30000]

export const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

/**
 * useLiveQuery with its error: `{ data, error }`. `data` is undefined until the first result and
 * resets when the query changes or the client stops; `error` is the last error from creating or
 * running the live query, cleared by the next result. After an error the hook keeps the last rows
 * and resubscribes with backoff (LIVE_QUERY_RETRY_DELAYS_MS) until a result arrives.
 */
export function useLiveQueryState<T>(
  query: ((sql: any) => any) | any | null | undefined
): { data: T[] | undefined; error: Error | null } {
  const [state, setState] = useState<{ data: T[] | undefined; error: Error | null }>({
    data: undefined,
    error: null,
  })
  // Bumped to resubscribe after an error.
  const [retryCount, setRetryCount] = useState(0)
  const isClientReady = useIsClientReady()

  const queryKey = queryKeyOf(query)
  const queryRef = useRef(query)
  queryRef.current = query
  const failuresRef = useRef(0)
  const subscribedForRef = useRef<{ queryKey: unknown; isClientReady: boolean } | null>(null)

  useEffect(() => {
    const previous = subscribedForRef.current
    subscribedForRef.current = { queryKey, isClientReady }
    if (!previous || previous.queryKey !== queryKey || previous.isClientReady !== isClientReady) {
      // A new (or no) query, or a client that started or stopped: drop the previous rows
      // (no re-render if already empty). A retry keeps them.
      failuresRef.current = 0
      setState((prev) => (prev.data === undefined && prev.error === null ? prev : { data: undefined, error: null }))
    }
    const current = queryRef.current
    if (!isClientReady || !current) {
      return
    }

    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const fail = (err: unknown) => {
      // Keep the last rows (no flicker on transient errors) and report the error
      setState((prev) => ({ data: prev.data, error: toError(err) }))
      const delay =
        LIVE_QUERY_RETRY_DELAYS_MS[Math.min(failuresRef.current, LIVE_QUERY_RETRY_DELAYS_MS.length - 1)]
      failuresRef.current += 1
      retryTimer = setTimeout(() => setRetryCount((n) => n + 1), delay)
    }

    let subscription: { unsubscribe: () => void } | undefined
    try {
      subscription = BaseDb.liveQuery<T>(current).subscribe({
        next: (results) => {
          failuresRef.current = 0
          // New array reference so React re-renders when SQLocal mutates row objects in place
          // on the same backing array (Object.is would otherwise bail out of useState).
          setState({ data: results !== undefined ? [...results] : undefined, error: null })
        },
        error: fail,
      })
    } catch (error) {
      fail(error)
    }

    return () => {
      subscription?.unsubscribe()
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [queryKey, isClientReady, retryCount])

  return state
}
