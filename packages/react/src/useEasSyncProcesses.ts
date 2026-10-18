import { useMemo } from 'react'
import { BaseDb, easSyncProcesses, type EasSyncProcessType } from '@seedprotocol/sdk'
import { desc, eq } from 'drizzle-orm'
import { useLiveQuery } from './liveQuery'
import { useIsClientReady } from './client'

export type EasSyncProcessRecord = EasSyncProcessType

/** The app DB once the client is ready; before that BaseDb.getAppDb() throws "Db not configured". */
function useAppDbWhenReady() {
  const isClientReady = useIsClientReady()
  return isClientReady ? BaseDb.getAppDb() : null
}

function useEasSyncProcessesQuery() {
  const db = useAppDbWhenReady()
  return useMemo(
    () =>
      db
        ? db.select().from(easSyncProcesses).orderBy(desc(easSyncProcesses.startedAt))
        : null,
    [db],
  )
}

/**
 * Single live subscription for `eas_sync_processes` ordered by `startedAt` descending plus a
 * derived count of rows whose status is not `in_progress`.
 */
export function useEasSyncProcessesState(): {
  records: EasSyncProcessRecord[] | undefined
  nonActiveCount: number | undefined
} {
  const query = useEasSyncProcessesQuery()
  const records = useLiveQuery(query) as EasSyncProcessRecord[] | undefined
  const nonActiveCount = useMemo(
    () =>
      records === undefined ? undefined : records.filter((r) => r.status !== 'in_progress').length,
    [records],
  )
  return { records, nonActiveCount }
}

export function useEasSyncProcesses(): EasSyncProcessRecord[] | undefined {
  const query = useEasSyncProcessesQuery()
  return useLiveQuery(query) as EasSyncProcessRecord[] | undefined
}

export function useEasSyncProcessesNonActiveCount(): number | undefined {
  return useEasSyncProcessesState().nonActiveCount
}

export function useEasSyncProcessById(
  id: number | undefined,
): { record: EasSyncProcessRecord | null; isLoading: boolean } {
  const db = useAppDbWhenReady()
  const query = useMemo(
    () =>
      id != null && db
        ? db.select().from(easSyncProcesses).where(eq(easSyncProcesses.id, id)).limit(1)
        : null,
    [db, id],
  )
  const records = useLiveQuery(query)
  // Without an id there is nothing to load: not loading forever. With one, waiting for the client
  // counts as loading.
  const isLoading = id != null && (db == null || records === undefined)
  const record = records && records.length > 0 ? (records[0] as EasSyncProcessRecord) : null
  return { record, isLoading }
}
