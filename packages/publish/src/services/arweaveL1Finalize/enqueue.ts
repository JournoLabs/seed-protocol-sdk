import { arweaveL1FinalizeJobs, BaseDb } from '@seedprotocol/sdk'
import type { ArweaveTransactionInfo, PublishMachineContext, PublishUpload } from '../../types'
import { getPublishConfig } from '~/config'

const PHASE_PENDING = 'pending_l1' as const

/**
 * Inserts one row per bundler DataItem id so the L1 finalize worker can resolve the L1 tx
 * and wait for anchoring. Idempotent on `data_item_id`.
 */
export async function enqueueArweaveL1FinalizeJobsFromPublishContext(
  context: PublishMachineContext,
): Promise<void> {
  const { useArweaveBundler } = getPublishConfig()
  if (!useArweaveBundler) return

  const txs = context.arweaveTransactions ?? []
  const uploads = (context.publishUploads ?? []) as PublishUpload[]
  if (txs.length === 0 || txs.length !== uploads.length) return

  const db = BaseDb.getAppDb()
  if (!db) return

  const now = Date.now()

  for (let i = 0; i < txs.length; i++) {
    const ar = txs[i] as ArweaveTransactionInfo
    const up = uploads[i]
    if (!up) continue
    const dataItemId = (ar.transaction as { id?: string })?.id
    if (!dataItemId || typeof dataItemId !== 'string') continue

    try {
      await db
        .insert(arweaveL1FinalizeJobs)
        .values({
          seedLocalId: up.seedLocalId,
          dataItemId,
          versionLocalId: up.versionLocalId ?? null,
          itemPropertyName: up.itemPropertyName ?? null,
          phase: PHASE_PENDING,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
    } catch {
      /* ignore duplicate or DB errors */
    }
  }
}
