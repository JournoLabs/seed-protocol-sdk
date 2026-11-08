import { findOpenPublishAttempts } from '@seedprotocol/sdk'
import { fromPromise } from 'xstate'

/** Whether the seed has an open attestation attempt, which keeps a waiting run from giving up. */
export const checkGiveUp = fromPromise(
  async ({ input: { seedLocalId } }: { input: { seedLocalId: string } }): Promise<{ open: boolean }> => ({
    open: (await findOpenPublishAttempts([seedLocalId])).length > 0,
  }),
)
