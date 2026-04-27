import { useMemo } from 'react'
import { BaseDb, easSyncProcesses, type EasSyncProcessType } from '@seedprotocol/sdk'
import { desc, eq } from 'drizzle-orm'
import { useLiveQuery } from './liveQuery'

export type EasSyncProcessRecord = EasSyncProcessType

function useEasSyncProcessesQuery() {
  const db = BaseDb.getAppDb()
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
  const db = BaseDb.getAppDb()
  const query = useMemo(
    () =>
      id != null && db
        ? db.select().from(easSyncProcesses).where(eq(easSyncProcesses.id, id)).limit(1)
        : null,
    [db, id],
  )
  const records = useLiveQuery(query)
  const isLoading = records === undefined
  const record = records && records.length > 0 ? (records[0] as EasSyncProcessRecord) : null
  return { record, isLoading }
}
