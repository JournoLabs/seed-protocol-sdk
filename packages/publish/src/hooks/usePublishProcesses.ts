import { useLiveQuery } from '@seedprotocol/react'
import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { desc, eq } from 'drizzle-orm'
import type { PublishProcessRecord } from './useItemPublishStatus'

export function usePublishProcesses(): PublishProcessRecord[] | undefined {
  const db = BaseDb.getAppDb()
  const records = useLiveQuery(
    db ? db.select().from(publishProcesses).orderBy(desc(publishProcesses.startedAt)) : null
  )
  return records as PublishProcessRecord[] | undefined
}

export function usePublishProcessesNonActiveCount(): number | undefined {
  const records = usePublishProcesses()
  if (records === undefined) return undefined
  return records.filter((r) => r.status !== 'in_progress').length
}

export function usePublishProcessById(
  id: number | undefined
): { record: PublishProcessRecord | null; isLoading: boolean } {
  const db = BaseDb.getAppDb()
  const records = useLiveQuery(
    id != null && db ? db.select().from(publishProcesses).where(eq(publishProcesses.id, id)).limit(1) : null
  )
  const isLoading = records === undefined
  const record = records && records.length > 0 ? (records[0] as PublishProcessRecord) : null
  return { record, isLoading }
}
