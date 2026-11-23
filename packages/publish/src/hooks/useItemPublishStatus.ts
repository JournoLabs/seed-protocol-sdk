import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from '@seedprotocol/react'
import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { eq, desc } from 'drizzle-orm'
import { usePublishProcess } from './usePublishProcess'
import { useArweaveL1Finalize } from './useArweaveL1Finalize'
import { describePublishRun, getPublishMachineValueForUi } from '~/helpers/publishDisplayHelpers'
import { publishLockHolder, type PublishLockHolder } from '~/services/publishManager/publishLocks'

export type PublishProcessStatus = 'in_progress' | 'completed' | 'failed' | 'interrupted'

export interface PublishProcessRecord {
  id: number
  seedLocalId: string
  modelName: string
  schemaId?: string
  status: PublishProcessStatus
  startedAt: number
  completedAt?: number
  errorMessage?: string
  errorStep?: string
  errorDetails?: string
  /** Stable error code (e.g. `ManagedAccountPublishError.code`) when the failure had one. */
  errorCode?: string
  persistedSnapshot: string
  createdAt?: number
  updatedAt?: number
}

/**
 * A seed's publish: the live run (if any), its latest `publish_processes` row and its Arweave L1
 * finalization jobs.
 *
 * `isActive` is true while a run is in flight: a publish actor is registered for the seed, or the
 * latest row is `in_progress`, and the run's value is not terminal (`success`, `failure`,
 * `stopping`). A run that ends is not active while its final save is still being written. A run
 * parked on a recoverable error (`describePublishRun(publishValue).awaitingRetry`) stays active:
 * it still holds the item and continues on `PublishManager.retryAttestations`.
 *
 * `heldBy` says which tab holds the seed's publish lock (`publishLockHolder`): `'here'`,
 * `'other-tab'` or `'none'`, and `undefined` until it is first read. When another tab holds it and
 * the row is `in_progress`, `publishValue` is the state that tab last saved, so a publish parked in
 * another tab reads `awaitingRetry` here too; it is retried in that tab. `heldBy` is read again when
 * the row or this tab's run changes, not when the lock changes: after the holding tab closes it
 * stays `'other-tab'` until the row next changes.
 */
export function useItemPublishStatus(seedLocalId: string | undefined) {
  const { publishProcess, value } = usePublishProcess(seedLocalId ?? '')
  const arweaveL1 = useArweaveL1Finalize(seedLocalId)

  const db = BaseDb.getAppDb()
  const latestProcessRowQuery = useMemo(
    () =>
      seedLocalId && db
        ? db
            .select()
            .from(publishProcesses)
            .where(eq(publishProcesses.seedLocalId, seedLocalId))
            .orderBy(desc(publishProcesses.startedAt))
            .limit(1)
        : null,
    [db, seedLocalId]
  )
  const latestRecords = useLiveQuery(latestProcessRowQuery)

  const record = latestRecords?.[0] as PublishProcessRecord | undefined

  const [heldBy, setHeldBy] = useState<PublishLockHolder | undefined>(undefined)
  const recordStatus = record?.status
  const recordUpdatedAt = record?.updatedAt
  // A new seed starts unknown; a row change keeps the last answer until the new one arrives.
  useEffect(() => setHeldBy(undefined), [seedLocalId])
  useEffect(() => {
    if (!seedLocalId) return
    let current = true
    publishLockHolder(seedLocalId).then(
      (holder) => {
        if (current) setHeldBy(holder)
      },
      () => {},
    )
    return () => {
      current = false
    }
  }, [seedLocalId, publishProcess, recordStatus, recordUpdatedAt])

  const publishValue =
    value ?? (heldBy === 'other-tab' && record?.status === 'in_progress' ? getPublishMachineValueForUi(record) : undefined)

  const isActive =
    !describePublishRun(value).terminal && (!!publishProcess || record?.status === 'in_progress')

  return {
    latestRecord: record,
    publishProcess,
    isActive,
    publishValue,
    heldBy,
    arweaveL1Pending: arweaveL1.hasPendingL1,
    arweaveL1Jobs: arweaveL1.jobs,
    arweaveL1Summary: arweaveL1,
  }
}
