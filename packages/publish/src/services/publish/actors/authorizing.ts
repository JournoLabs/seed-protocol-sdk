import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { getPublishConfig } from '~/config'
import { resolvePublishPayment } from '~/payment'
import { runAuthorizePublish, type PublishAuthorization } from '~/authorization'
import { estimatePublishCost } from '~/services/publishCost/estimatePublishCost'

function configAuthorizePublish() {
  try {
    return getPublishConfig().authorizePublish
  } catch {
    return undefined
  }
}

/**
 * First publish step: asks `authorizePublish` (per publish, else from config) to approve before
 * anything is spent. Resolves with the authorization (its token rides along in context).
 */
export const authorizing = fromPromise(
  async ({ input: { context } }: { input: { context: PublishMachineContext } }): Promise<PublishAuthorization> => {
    const { item } = context
    // A publish restored from the DB has no functions in its context; fall back to the config hook.
    const authorizePublish = context.authorizePublish ?? configAuthorizePublish()
    if (!authorizePublish) return {}
    const publishMode = context.publishMode ?? 'patch'
    return runAuthorizePublish(authorizePublish, {
      item,
      seedLocalId: item.seedLocalId,
      publishMode,
      payment: resolvePublishPayment(getPublishConfig()),
      getEstimate: () => estimatePublishCost(item, { publishMode }),
    })
  },
)
