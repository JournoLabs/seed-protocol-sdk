import { useLiveQuery } from '@seedprotocol/react'
import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { eq, desc } from 'drizzle-orm'
import { usePublishProcess } from './usePublishProcess'

export type PublishProcessStatus = 'in_progress' | 'completed' | 'failed' | 'interrupted'

export interface PublishProcessRecord {
  id?: number
  seedLocalId: string
  modelName: string
  schemaId?: string
  status: PublishProcessStatus
  startedAt: number
  completedAt?: number
  errorMessage?: string
  errorStep?: string
  errorDetails?: string
  persistedSnapshot: string
  createdAt?: number
  updatedAt?: number
}

export function useItemPublishStatus(seedLocalId: string | undefined) {
  const { publishProcess, value } = usePublishProcess(seedLocalId ?? '')

  const db = BaseDb.getAppDb()
  const latestRecords = useLiveQuery(
    seedLocalId && db
      ? db
          .select()
          .from(publishProcesses)
          .where(eq(publishProcesses.seedLocalId, seedLocalId))
          .orderBy(desc(publishProcesses.startedAt))
          .limit(1)
      : null
  )

  const record = latestRecords?.[0] as PublishProcessRecord | undefined
  const isActive = !!publishProcess || record?.status === 'in_progress'

  return {
    latestRecord: record,
    publishProcess,
    isActive,
    publishValue: value,
  }
}
