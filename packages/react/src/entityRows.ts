import { useEffect, useRef, useState } from 'react'
import { isChangeFeedRunning, watchEntityRows, type ChangeWatch } from '@seedprotocol/sdk'
import { useIsClientReady } from './client'
import { queryKeyOf, toError, useLiveQueryState } from './liveQuery'

type RowsQuery = { all: () => Promise<unknown[]>; toSQL: () => { sql: string; params: unknown[] } }

/**
 * Rows of a Drizzle query on one seed's rows, re-read when the SDK's change feed reports a write
 * to them (ADR 0020), instead of a liveQuery that re-runs on every write to the tables it reads.
 * `watch` names the seed and tables the query reads; it must cover every row the query returns.
 * Same `{ data, error }` as useLiveQueryState: `data` is undefined until the first read and resets
 * when the query or watch changes. A failed read reports `error` and keeps the last rows; the next
 * change reads again. Where the feed doesn't run (Node), falls back to useLiveQueryState.
 */
export function useEntityRowsState<T>(
  watch: ChangeWatch | null | undefined,
  query: RowsQuery | null | undefined,
): { data: T[] | undefined; error: Error | null } {
  const isClientReady = useIsClientReady()
  const onFeed = isClientReady && isChangeFeedRunning()
  const fallback = useLiveQueryState<T>(onFeed ? null : query)

  const [state, setState] = useState<{ data: T[] | undefined; error: Error | null }>({
    data: undefined,
    error: null,
  })
  const key = watch && query ? `${JSON.stringify(watch)}|${String(queryKeyOf(query))}` : null
  const inputsRef = useRef({ watch, query })
  inputsRef.current = { watch, query }

  useEffect(() => {
    setState((prev) => (prev.data === undefined && prev.error === null ? prev : { data: undefined, error: null }))
    const { watch: currentWatch, query: currentQuery } = inputsRef.current
    if (!onFeed || !key || !currentWatch || !currentQuery) return
    const subscription = watchEntityRows<T[]>(
      currentWatch,
      () => currentQuery.all() as Promise<T[]>,
      (rows) => setState({ data: [...rows], error: null }),
      {
        immediate: true,
        onError: (error) => setState((prev) => ({ data: prev.data, error: toError(error) })),
      },
    )
    return () => subscription.unsubscribe()
  }, [key, onFeed])

  return onFeed ? state : fallback
}
