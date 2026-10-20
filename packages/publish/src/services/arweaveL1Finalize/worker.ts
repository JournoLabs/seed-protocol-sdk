import {
  arweaveL1FinalizeJobs,
  BaseDb,
  getArweaveUploadStatus,
  isArweaveL1AnchoringComplete,
  queryArweaveGatewayTransactionWithFallback,
  restoreDataItemIdsOverwrittenByL1,
} from '@seedprotocol/sdk'
import { eq } from 'drizzle-orm'
import { getPublishConfig } from '~/config'
import { resolvePublishPayment } from '~/payment'
import debug from 'debug'

const logger = debug('seedProtocol:arweaveL1Finalize:worker')

/**
 * Tracks bundler uploads until their bundle is anchored on Arweave L1, recording the L1 / bundle id
 * in `arweave_l1_finalize_jobs`. Local metadata keeps the data item id, which is what was attested
 * and what gateways serve the item under.
 */
const TICK_MS = 45_000

let intervalId: ReturnType<typeof setInterval> | null = null
let restoredOverwrittenIds = false

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

  // initPublish may start this worker before Seed platformClassesInit configures BaseDb.
  if (!BaseDb.isAppDbReady()) return
  const db = BaseDb.getAppDb()
  if (!db) return

  // The worker used to replace local data item ids with the bundle's L1 id; put them back once.
  if (!restoredOverwrittenIds) {
    restoredOverwrittenIds = true
    try {
      const { restored, ambiguous } = await restoreDataItemIdsOverwrittenByL1()
      if (restored || ambiguous) {
        logger(`restored ${restored} data item ids overwritten by L1 ids; ${ambiguous} bundles ambiguous, left as they are`)
      }
    } catch (error) {
      logger('restoring data item ids failed', error)
    }
  }

  const pending = await db
    .select()
    .from(arweaveL1FinalizeJobs)
    .where(eq(arweaveL1FinalizeJobs.phase, 'pending_l1'))
    .limit(25)

  if (pending.length === 0) return

  const uploadBase = config.arweaveUploadVerificationBaseUrl
  const graphqlUrl = config.arweaveGraphqlUrl
  // User-paid uploads went to Turbo; the upload API doesn't know them, so finish from GraphQL.
  const uploadedToTurbo = resolvePublishPayment(config).storage.uploadTo === 'turbo'

  for (const job of pending) {
    const dataItemId = job.dataItemId
    try {
      let l1TxId = job.l1TransactionId

      if (uploadedToTurbo) {
        const gql = await queryArweaveGatewayTransactionWithFallback(graphqlUrl, dataItemId)
        const bundled = gql?.bundledInId ?? l1TxId ?? null
        if (bundled && gql?.blockHeight != null) {
          await db
            .update(arweaveL1FinalizeJobs)
            .set({
              phase: 'confirmed',
              statusJson: JSON.stringify(gql),
              l1TransactionId: bundled,
              bundleId: bundled,
              updatedAt: Date.now(),
            })
            .where(eq(arweaveL1FinalizeJobs.id, job.id!))
        }
        continue
      }

      if (!l1TxId) {
        const gql = await queryArweaveGatewayTransactionWithFallback(graphqlUrl, dataItemId)
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
