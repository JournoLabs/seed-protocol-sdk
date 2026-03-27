import { useEffect, useState, useRef, useMemo } from 'react'
import { BaseDb } from '@seedprotocol/sdk'
import { Observable } from 'rxjs'
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
  const [data, setData] = useState<T[] | undefined>(undefined)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const isClientReady = useIsClientReady()

  // Create Observable outside useEffect so it's stable and distinctUntilChanged can work
  // Only recreate when query or isClientReady changes
  const observable = useMemo(() => {
    if (!isClientReady || !query) {
      return null
    }
    try {
      return BaseDb.liveQuery<T>(query)
    } catch (error) {
      console.error('[useLiveQuery] Failed to create live query:', error)
      return null
    }
  }, [query, isClientReady])

  useEffect(() => {
    // Cleanup previous subscription if it exists
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }

    // Don't subscribe if observable is null
    if (!observable) {
      return
    }

    const subscription = observable.subscribe({
      next: (results) => {
        // New array reference so React re-renders when SQLocal mutates row objects in place
        // on the same backing array (Object.is would otherwise bail out of useState).
        setData(results !== undefined ? [...results] : undefined)
      },
      error: (err) => {
        console.error('[useLiveQuery] Error:', err)
        // Don't set data to undefined on error - keep last known good state
        // This prevents UI flickering on transient errors
      },
    })

    subscriptionRef.current = subscription

    // Cleanup on unmount or observable change
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [observable]) // Only re-subscribe when observable changes

  return data
}

