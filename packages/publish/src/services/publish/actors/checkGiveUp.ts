import { findOpenPublishAttempts } from '@seedprotocol/sdk'
import { fromPromise } from 'xstate'

export type GiveUpCheck = { open: boolean; attemptId?: string }

/** Whether the seed has an open attestation attempt, which keeps a waiting run from giving up. */
export const checkGiveUp = fromPromise(
  async ({ input: { seedLocalId } }: { input: { seedLocalId: string } }): Promise<GiveUpCheck> => {
    const [attempt] = await findOpenPublishAttempts([seedLocalId])
    return attempt ? { open: true, attemptId: attempt.id } : { open: false }
  },
)

/**
 * The warning `giveUp` logs when an open attempt keeps the run waiting: which attempt, and what
 * settles it from the state the run waits in.
 */
export function giveUpWaitsMessage(seedLocalId: string, attemptId: string | undefined, waitingIn: string): string {
  const attempt = attemptId ? `attestation attempt ${attemptId}` : 'an attestation attempt'
  const wayOut =
    waitingIn === 'attestationOutcomeUnknown'
      ? `It may have landed and the chain can't say. resolveAttestationAttempt(seedLocalId, { txHash }) records it, ` +
        `or { resend: true } gives it up and sends again; stopPublish ends the run as interrupted and leaves the attempt open.`
      : `retryAttestations settles it from the chain, then giveUpPublish ends the run.`
  return `[@seedprotocol/publish] giveUpPublish: the publish of "${seedLocalId}" keeps waiting in ${waitingIn} while ${attempt} is open. ${wayOut}`
}
