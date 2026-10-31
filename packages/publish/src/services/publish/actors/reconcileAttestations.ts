import { findOpenPublishAttempts, updatePublishAttempt } from '@seedprotocol/sdk'
import debug from 'debug'
import type { Hex } from 'viem'
import { fromPromise } from 'xstate'
import { AttestationOutcomeUnknownError, PublishTransactionRevertedError } from '~/errors'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import type { PublishMachineContext, UnrecordedAttestation } from '../../../types'
import { recordMultiPublishReceipt } from './recordMultiPublishReceipt'

const logger = debug('seedProtocol:services:publish:actors:reconcileAttestations')

export type ReconcileResult =
  /** No earlier attempt can have landed: go on to the send. */
  | { outcome: 'send' }
  /** This run's transaction landed: record it, and send nothing. */
  | { outcome: 'record'; unrecorded: UnrecordedAttestation }
  /** An earlier attempt may have landed and nothing here can tell. */
  | { outcome: 'unknown'; error: AttestationOutcomeUnknownError }

/**
 * Settles the seed's open attempt before anything can send, on every retry and restore. An attempt
 * with a hash is read from the chain. One without a hash is unknown: it was committed before a send
 * that may or may not have gone out, and resending could attest twice.
 *
 * Another run's landed transaction is recorded here, so that this run builds its payload on top of
 * it and sends what is left.
 */
export const reconcileAttestations = fromPromise(
  async ({ input: { context } }: { input: { context: PublishMachineContext } }): Promise<ReconcileResult> => {
    const seedLocalId = context.item?.seedLocalId
    if (!seedLocalId) return { outcome: 'send' }

    for (;;) {
      const [attempt] = await findOpenPublishAttempts([seedLocalId])
      if (!attempt) return { outcome: 'send' }
      if (!attempt.txHash) {
        return { outcome: 'unknown', error: new AttestationOutcomeUnknownError(seedLocalId, attempt) }
      }

      let receipt: Awaited<ReturnType<typeof waitForPublishReceipt>>
      try {
        receipt = await waitForPublishReceipt(attempt.txHash as Hex)
      } catch (err) {
        if (err instanceof PublishTransactionRevertedError) {
          await updatePublishAttempt(attempt.id, { status: 'reverted' })
          continue
        }
        logger('no receipt for %s: %O', attempt.txHash, err)
        return { outcome: 'unknown', error: new AttestationOutcomeUnknownError(seedLocalId, attempt, err) }
      }

      const unrecorded: UnrecordedAttestation = {
        attemptId: attempt.id,
        transactionHash: attempt.txHash as Hex,
        requests: JSON.parse(attempt.requests) as unknown[],
        attester: attempt.attester,
      }
      if (attempt.publishRunId === context.publishRunId) return { outcome: 'record', unrecorded }

      await recordMultiPublishReceipt({
        receipt,
        requests: unrecorded.requests as Parameters<typeof recordMultiPublishReceipt>[0]['requests'],
        rootSeedLocalId: undefined,
        publisherAddress: context.address as string,
        attester: attempt.attester,
        attemptId: attempt.id,
      })
    }
  },
)
