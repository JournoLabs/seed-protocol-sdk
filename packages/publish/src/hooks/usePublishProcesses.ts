import { useMemo } from 'react'
import { useLiveQuery } from '@seedprotocol/react'
import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { desc, eq } from 'drizzle-orm'
import type { PublishProcessRecord } from './useItemPublishStatus'

function usePublishProcessesQuery() {
  const db = BaseDb.getAppDb()
  return useMemo(
    () => (db ? db.select().from(publishProcesses).orderBy(desc(publishProcesses.startedAt)) : null),
    [db]
  )
}

function usePublishProcessesQueryForSeed(seedLocalId: string | undefined) {
  const db = BaseDb.getAppDb()
  return useMemo(
    () =>
      db && seedLocalId
        ? db
            .select()
            .from(publishProcesses)
            .where(eq(publishProcesses.seedLocalId, seedLocalId))
            .orderBy(desc(publishProcesses.startedAt))
        : null,
    [db, seedLocalId]
  )
}

/**
 * Single live subscription for the ordered publish_processes list plus a derived non-active count.
 * Prefer this when you need both values in one component so you do not combine
 * {@link usePublishProcesses} and {@link usePublishProcessesNonActiveCount} (which would subscribe twice).
 */
export function usePublishProcessesState(): {
  records: PublishProcessRecord[] | undefined
  nonActiveCount: number | undefined
} {
  const query = usePublishProcessesQuery()
  const records = useLiveQuery(query) as PublishProcessRecord[] | undefined
  const nonActiveCount = useMemo(
    () => (records === undefined ? undefined : records.filter((r) => r.status !== 'in_progress').length),
    [records]
  )
  return { records, nonActiveCount }
}

export function usePublishProcesses(): PublishProcessRecord[] | undefined {
  const query = usePublishProcessesQuery()
  return useLiveQuery(query) as PublishProcessRecord[] | undefined
}

export function usePublishProcessesNonActiveCount(): number | undefined {
  return usePublishProcessesState().nonActiveCount
}

/**
 * Live query of `publish_processes` for one seed, ordered by `startedAt` descending.
 * Pass `undefined` to disable the query (returns `undefined`).
 */
export function usePublishProcessesForSeed(
  seedLocalId: string | undefined
): PublishProcessRecord[] | undefined {
  const query = usePublishProcessesQueryForSeed(seedLocalId)
  return useLiveQuery(query) as PublishProcessRecord[] | undefined
}

/**
 * Same as {@link usePublishProcessesForSeed} plus a derived count of rows whose status is not
 * `in_progress`. Prefer this over combining {@link usePublishProcessesForSeed} and a separate
 * count hook so you only subscribe once.
 */
export function usePublishProcessesStateForSeed(seedLocalId: string | undefined): {
  records: PublishProcessRecord[] | undefined
  nonActiveCount: number | undefined
} {
  const query = usePublishProcessesQueryForSeed(seedLocalId)
  const records = useLiveQuery(query) as PublishProcessRecord[] | undefined
  const nonActiveCount = useMemo(
    () => (records === undefined ? undefined : records.filter((r) => r.status !== 'in_progress').length),
    [records]
  )
  return { records, nonActiveCount }
}

export function usePublishProcessesNonActiveCountForSeed(
  seedLocalId: string | undefined
): number | undefined {
  return usePublishProcessesStateForSeed(seedLocalId).nonActiveCount
}

export function usePublishProcessById(
  id: number | undefined
): { record: PublishProcessRecord | null; isLoading: boolean } {
  const db = BaseDb.getAppDb()
  const query = useMemo(
    () =>
      id != null && db
        ? db.select().from(publishProcesses).where(eq(publishProcesses.id, id)).limit(1)
        : null,
    [db, id]
  )
  const records = useLiveQuery(query)
  const isLoading = records === undefined
  const record = records && records.length > 0 ? (records[0] as PublishProcessRecord) : null
  return { record, isLoading }
}
