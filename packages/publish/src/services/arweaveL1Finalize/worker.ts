import {
  applyArweaveL1TransactionIdLocal,
  arweaveL1FinalizeJobs,
  BaseDb,
  getArweaveUploadStatus,
  isArweaveL1AnchoringComplete,
  queryArweaveGatewayTransaction,
} from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import { getPublishConfig } from '~/config'
import debug from 'debug'

const logger = debug('seedProtocol:arweaveL1Finalize:worker')

const TICK_MS = 45_000

let intervalId: ReturnType<typeof setInterval> | null = null

export function startArweaveL1FinalizeWorker(): void {
  if (intervalId != null) return
  intervalId = setInterval(() => {
    void runArweaveL1FinalizeTick()
  }, TICK_MS)
  void runArweaveL1FinalizeTick()
}

export function stopArweaveL1FinalizeWorker(): void {
  if (intervalId != null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

async function runArweaveL1FinalizeTick(): Promise<void> {
  let config: ReturnType<typeof getPublishConfig>
  try {
    config = getPublishConfig()
  } catch {
    return
  }
  if (!config.useArweaveBundler) return

  const db = BaseDb.getAppDb()
  if (!db) return

  const pending = await db
    .select()
    .from(arweaveL1FinalizeJobs)
    .where(eq(arweaveL1FinalizeJobs.phase, 'pending_l1'))
    .limit(25)

  if (pending.length === 0) return

  const uploadBase = config.arweaveUploadVerificationBaseUrl
  const graphqlUrl = config.arweaveGraphqlUrl

  for (const job of pending) {
    const dataItemId = job.dataItemId
    try {
      let l1TxId = job.l1TransactionId

      if (!l1TxId) {
        const gql = await queryArweaveGatewayTransaction(graphqlUrl, dataItemId)
        const bundled = gql?.bundledInId ?? null
        if (bundled) {
          l1TxId = bundled
          await db
            .update(arweaveL1FinalizeJobs)
            .set({
              l1TransactionId: bundled,
              bundleId: bundled,
              updatedAt: Date.now(),
            })
            .where(eq(arweaveL1FinalizeJobs.id, job.id!))
        }
      }

      const status = await getArweaveUploadStatus(uploadBase, dataItemId)
      const statusStr = status ? JSON.stringify(status) : null

      if (status && isArweaveL1AnchoringComplete(status)) {
        const resolvedL1 =
          l1TxId ??
          status.bundleId ??
          status.turbo?.bundleId ??
          job.l1TransactionId ??
          null

        if (resolvedL1) {
          await applyArweaveL1TransactionIdLocal({
            seedLocalId: job.seedLocalId,
            versionLocalId: job.versionLocalId,
            dataItemId,
            l1TransactionId: resolvedL1,
          })
        }

        await db
          .update(arweaveL1FinalizeJobs)
          .set({
            phase: 'confirmed',
            statusJson: statusStr,
            l1TransactionId: resolvedL1 ?? job.l1TransactionId,
            bundleId: status.bundleId ?? job.bundleId,
            updatedAt: Date.now(),
          })
          .where(eq(arweaveL1FinalizeJobs.id, job.id!))
        continue
      }

      await db
        .update(arweaveL1FinalizeJobs)
        .set({
          statusJson: statusStr,
          updatedAt: Date.now(),
        })
        .where(eq(arweaveL1FinalizeJobs.id, job.id!))
    } catch (err) {
      logger('tick error for job', job.id, err)
      await db
        .update(arweaveL1FinalizeJobs)
        .set({
          errorMessage: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now(),
        })
        .where(eq(arweaveL1FinalizeJobs.id, job.id!))
    }
  }
}
