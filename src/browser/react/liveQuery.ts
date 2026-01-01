import { useEffect, useState, useRef } from 'react'
import { BaseDb } from '@/db/Db/BaseDb'
import { Observable } from 'rxjs'

/**
 * Hook to execute a reactive query that emits new results whenever the underlying data changes.
 * 
 * Supports two usage patterns:
 * 1. SQL tag function: useLiveQuery((sql) => sql`SELECT * FROM models`)
 * 2. Drizzle query builder: useLiveQuery(db.select().from(models))
 * 
 * @param query - SQL query function or Drizzle query builder
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
 * import { models } from '@/seedSchema'
 * import { eq } from 'drizzle-orm'
 * 
 * const appDb = BaseDb.getAppDb()
 * const models = useLiveQuery<ModelRow>(
 *   appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
 * )
 * ```
 */
export function useLiveQuery<T>(
  query: ((sql: any) => any) | any
): T[] | undefined {
  const [data, setData] = useState<T[] | undefined>(undefined)
  const queryRef = useRef<((sql: any) => any) | any>(query)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  
  // Update query ref when query changes
  // Note: For best performance, queries should be stable or memoized
  useEffect(() => {
    queryRef.current = query
  }, [query])
  
  useEffect(() => {
    // Cleanup previous subscription if it exists
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    
    // Subscribe to live query
    const observable: Observable<T[]> = BaseDb.liveQuery<T>(queryRef.current)
    
    const subscription = observable.subscribe({
      next: (results) => {
        setData(results)
      },
      error: (err) => {
        console.error('[useLiveQuery] Error:', err)
        // Don't set data to undefined on error - keep last known good state
        // This prevents UI flickering on transient errors
      },
    })
    
    subscriptionRef.current = subscription
    
    // Cleanup on unmount or query change
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [query]) // Re-subscribe when query changes
  
  return data
}

