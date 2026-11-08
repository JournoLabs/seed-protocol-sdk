import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { settleOpenAttempts, type ReconcileResult } from '../settleOpenAttempts'

export type { ReconcileResult }

/**
 * Settles the seed's open attempts before anything can send, on every retry and restore
 * (`settleOpenAttempts`). Another run's landed transaction is recorded here, so that this run builds
 * its payload on top of it and sends what is left. So is any landed direct EAS transaction: the
 * actor rebuilds its payload from the rows and skips what they hold.
 */
export const reconcileAttestations = fromPromise(
  async ({ input: { context } }: { input: { context: PublishMachineContext } }): Promise<ReconcileResult> => {
    const seedLocalId = context.item?.seedLocalId
    if (!seedLocalId) return { outcome: 'send' }
    return settleOpenAttempts({
      seedLocalId,
      publishRunId: context.publishRunId,
      publisher: context.address as string,
    })
  },
)
