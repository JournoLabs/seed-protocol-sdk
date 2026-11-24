import { findOpenPublishAttempts, updatePublishAttempt } from '@seedprotocol/sdk'
import debug from 'debug'
import type { Address, Hex } from 'viem'
import { AttestationOutcomeUnknownError, PublishTransactionRevertedError, type AttestationUnknownReason } from '~/errors'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { findPinnedUserOp, readNonceSequence } from '~/helpers/pinnedNonce'
import type { UnrecordedAttestation } from '../../types'
import {
  recordDirectAttestation,
  type DirectAttestationStep,
  type DirectAttestationTarget,
} from './actors/recordDirectAttestation'
import { recordMultiPublishReceipt, recordRelatedSeedUid } from './actors/recordMultiPublishReceipt'

const logger = debug('seedProtocol:services:publish:settleOpenAttempts')

export type ReconcileResult =
  /** No earlier attempt can have landed: go on to the send, under this attempt's key if given. */
  | { outcome: 'send'; resumeAttemptId?: string }
  /** This run's transaction landed: record it, and send nothing. */
  | { outcome: 'record'; unrecorded: UnrecordedAttestation }
  /** An earlier attempt may have landed and nothing here can tell. */
  | { outcome: 'unknown'; error: AttestationOutcomeUnknownError }

/**
 * Settles a seed's open attempts from the chain, one at a time. An attempt with a hash is read from
 * its receipt. One with a pinned nonce is settled from EntryPoint, hash or not: its key's sequence
 * says whether it landed, and sending again under that key can't land twice. Any other attempt
 * without a hash is unknown: it was committed before a send that may or may not have gone out, and
 * resending could attest twice.
 *
 * A landed transaction from another run, or from any run when `publishRunId` is undefined, is
 * recorded here with `publisher` on its rows. So is any landed direct EAS transaction. Only the run
 * named by `publishRunId` gets `record` back for its own multiPublish, or `send` with
 * `resumeAttemptId` for its own pinned attempt that hasn't landed.
 */
export async function settleOpenAttempts({
  seedLocalId,
  publishRunId,
  publisher,
}: {
  seedLocalId: string
  publishRunId: string | undefined
  publisher: string
}): Promise<ReconcileResult> {
  for (;;) {
    const [attempt] = await findOpenPublishAttempts([seedLocalId])
    if (!attempt) return { outcome: 'send' }
    const unknown = (reason: AttestationUnknownReason, cause?: unknown): ReconcileResult => ({
      outcome: 'unknown',
      error: new AttestationOutcomeUnknownError(seedLocalId, attempt, reason, cause),
    })
    const ownRun = publishRunId !== undefined && attempt.publishRunId === publishRunId

    if (!attempt.txHash) {
      if (!attempt.nonceKey || !attempt.entryPoint || !attempt.fromBlock) return unknown('noEvidence')
      const pin = {
        entryPoint: attempt.entryPoint as Address,
        sender: attempt.sender as Address,
        key: BigInt(attempt.nonceKey),
      }
      try {
        if ((await readNonceSequence(pin.entryPoint, pin.sender, pin.key)) === 0n) {
          // Not landed. Only this run has the same requests to send under the same key.
          if (!ownRun) return unknown('pinnedNotLanded')
          return { outcome: 'send', resumeAttemptId: attempt.id }
        }
        const userOp = await findPinnedUserOp({ ...pin, fromBlock: BigInt(attempt.fromBlock) })
        if (!userOp) return unknown('chainUnreadable')
        await updatePublishAttempt(
          attempt.id,
          userOp.success ? { status: 'sent', txHash: userOp.transactionHash } : { status: 'reverted' },
        )
        continue
      } catch (err) {
        logger('reading the pinned nonce of %s failed: %O', attempt.id, err)
        return unknown('chainUnreadable', err)
      }
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
      return unknown('chainUnreadable', err)
    }

    if (attempt.step !== 'multiPublish') {
      const [target] = JSON.parse(attempt.requests) as DirectAttestationTarget[]
      const step = attempt.step as DirectAttestationStep
      const { uids, attestationMs } = await recordDirectAttestation({
        step,
        target: target!,
        receipt,
        attester: attempt.attester,
        publisher,
        attemptId: attempt.id,
      })
      if (step === 'seed') {
        await recordRelatedSeedUid({
          seedLocalId: target!.localId,
          seedUid: uids[0]!,
          publisherAddress: publisher,
          attestationCreatedAtMs: attestationMs,
        })
      }
      continue
    }

    const unrecorded: UnrecordedAttestation = {
      attemptId: attempt.id,
      transactionHash: attempt.txHash as Hex,
      requests: JSON.parse(attempt.requests) as unknown[],
      attester: attempt.attester,
    }
    if (ownRun) return { outcome: 'record', unrecorded }

    await recordMultiPublishReceipt({
      receipt,
      requests: unrecorded.requests as Parameters<typeof recordMultiPublishReceipt>[0]['requests'],
      rootSeedLocalId: undefined,
      publisherAddress: publisher,
      attester: attempt.attester,
      attemptId: attempt.id,
    })
  }
}
