import { useEffect, useState, useRef, useMemo } from 'react'
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
function queryKeyOf(query: unknown): unknown {
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

/**
 * useLiveQuery with its error: `{ data, error }`. `data` is undefined until the first result and
 * resets when the query changes; `error` is the last error from the live query, cleared by the
 * next result.
 */
export function useLiveQueryState<T>(
  query: ((sql: any) => any) | any | null | undefined
): { data: T[] | undefined; error: Error | null } {
  const [state, setState] = useState<{ data: T[] | undefined; error: Error | null }>({
    data: undefined,
    error: null,
  })
  const isClientReady = useIsClientReady()

  const queryKey = queryKeyOf(query)
  const queryRef = useRef(query)
  queryRef.current = query

  // Create Observable outside useEffect so it's stable and distinctUntilChanged can work.
  // Only recreate when the query's identity or isClientReady changes.
  const observable = useMemo(() => {
    const current = queryRef.current
    if (!isClientReady || !current) {
      return null
    }
    try {
      return BaseDb.liveQuery<T>(current)
    } catch (error) {
      console.error('[useLiveQuery] Failed to create live query:', error)
      return null
    }
  }, [queryKey, isClientReady])

  useEffect(() => {
    // A new (or no) query: drop the previous query's rows (no re-render if already empty)
    setState((prev) => (prev.data === undefined && prev.error === null ? prev : { data: undefined, error: null }))
    if (!observable) {
      return
    }

    const subscription = observable.subscribe({
      next: (results) => {
        // New array reference so React re-renders when SQLocal mutates row objects in place
        // on the same backing array (Object.is would otherwise bail out of useState).
        setState({ data: results !== undefined ? [...results] : undefined, error: null })
      },
      error: (err) => {
        console.error('[useLiveQuery] Error:', err)
        // Keep the last rows (no flicker on transient errors) and report the error
        setState((prev) => ({ data: prev.data, error: err instanceof Error ? err : new Error(String(err)) }))
      },
    })

    return () => subscription.unsubscribe()
  }, [observable])

  return state
}
