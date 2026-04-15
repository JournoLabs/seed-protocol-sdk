import { useMemo } from 'react'
import { useLiveQuery } from '@seedprotocol/react'
import { arweaveL1FinalizeJobs, BaseDb } from '@seedprotocol/sdk'
import { eq, desc } from 'drizzle-orm'

export type ArweaveL1FinalizeJobRow = {
  id: number
  seedLocalId: string
  dataItemId: string
  l1TransactionId: string | null
  bundleId: string | null
  phase: string
  statusJson: string | null
  errorMessage: string | null
  versionLocalId: string | null
  itemPropertyName: string | null
  updatedAt: number | null
}

/**
 * Live L1 finalization jobs for a seed (bundler path). Empty when not using bundler or no jobs.
 */
export function useArweaveL1Finalize(seedLocalId: string | undefined) {
  const db = BaseDb.getAppDb()
  const jobsQuery = useMemo(
    () =>
      seedLocalId && db
        ? db
            .select()
            .from(arweaveL1FinalizeJobs)
            .where(eq(arweaveL1FinalizeJobs.seedLocalId, seedLocalId))
            .orderBy(desc(arweaveL1FinalizeJobs.updatedAt))
        : null,
    [db, seedLocalId]
  )
  const rows = useLiveQuery(jobsQuery)

  const jobs = (rows ?? []) as ArweaveL1FinalizeJobRow[]

  const summary = useMemo(() => {
    const pending = jobs.filter((j) => j.phase === 'pending_l1').length
    const confirmed = jobs.filter((j) => j.phase === 'confirmed').length
    return {
      hasPendingL1: pending > 0,
      pendingCount: pending,
      confirmedCount: confirmed,
      jobs,
    }
  }, [jobs])

  return summary
}
