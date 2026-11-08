import {
  claimPublishAttempt,
  findOpenPublishAttempts,
  updatePublishAttempt,
  type PublishAttemptStatus,
} from '@seedprotocol/sdk'
import debug from 'debug'
import type { Address, Hex } from 'viem'
import { AttestationAttemptOpenError, isManagedAccountPublishError, PublishTransactionRevertedError } from '~/errors'
import { getPublishBlockNumber, waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishViemChain } from '~/helpers/chainConfig'
import { usableHostNonceKey } from '~/helpers/hostNonceKey'
import { nonceKeyForAttempt } from '~/helpers/pinnedNonce'
import { errorChain } from '~/helpers/repeatingAttestationError'
import { isNonceTooLowError } from '~/helpers/retryNonceTooLow'
import type { SeedTxSender } from '~/helpers/seedSigner'
import type { DirectAttestationStep } from './recordDirectAttestation'

const logger = debug('seedProtocol:services:publish:actors:sendAttested')

/**
 * What a failed send says about the transaction. `undefined` means it can't tell, which includes
 * every timeout: a UserOp sender waits for inclusion inside `sendTransaction`, so its throw can
 * come after the bundler accepted the UserOp, and the attempt stays open.
 */
export function attemptStatusAfterFailedSend(err: unknown): 'notSent' | 'reverted' | undefined {
  const chain = errorChain(err)
  const reverted = chain.some(
    (e) =>
      e instanceof PublishTransactionRevertedError ||
      (isManagedAccountPublishError(e) && (e.code === 'USEROP_REVERTED' || e.code === 'USEROP_FAILED_NO_REASON')),
  )
  if (reverted) return 'reverted'
  if (isNonceTooLowError(err)) return 'notSent'
  const text = chain
    .map((e) => {
      const { message, details, code } = e as { message?: unknown; details?: unknown; code?: unknown }
      return `${String(message ?? e)} ${String(details ?? '')} ${String(code ?? '')}`
    })
    .join(' ')
  // AA25 is excluded: a used EntryPoint nonce can mean this very send already landed.
  return /user (rejected|denied)|ACTION_REJECTED|\b4001\b|insufficient funds|\bAA(?!25)\d\d\b/i.test(text)
    ? 'notSent'
    : undefined
}

export type AttestedSend = {
  publishRunId?: string
  seedLocalId: string
  /** The normalized requests, in the order they are sent. */
  requests: Array<{ localId?: string }>
  sender: Pick<SeedTxSender, 'address' | 'pinsNonceOn'>
  attester: string
  /**
   * Sends under `nonceKey`. Gets `onNonceKeyIgnored` with a key, for `SeedTxRequest.onNonceKeyIgnored`:
   * the attempt is then recorded with no key, so reconcile reads its hash, or reports the outcome
   * unknown, rather than trusting a sequence the send never used.
   */
  send: (nonceKey?: bigint, onNonceKeyIgnored?: () => void) => Promise<{ transactionHash: Hex }>
  /** Which transaction this is: a direct EAS publish sends several per request. */
  step?: 'multiPublish' | DirectAttestationStep
  /**
   * An open attempt reconcile found not landed, to send again under its own nonce key. A new key
   * would let the old UserOp, if it is still pending, land beside this one.
   */
  resumeAttemptId?: string
  /** CreatePublishOptions.nonceKey: a new attempt sends under the key derived from it. */
  hostNonceKey?: string
}

/**
 * The one way an attestation transaction goes out: commits an attempt row first, and refuses when
 * an open attempt covers any of these seeds, whichever run, retry or restore got here.
 * @throws AttestationAttemptOpenError when an open attempt is in the way; nothing was sent
 * @throws PublishNonceKeyError when `hostNonceKey` can't be used; nothing was sent
 * @throws whatever `send` throws, after closing the attempt when that error settles what happened
 */
export async function sendAttested({
  publishRunId,
  seedLocalId,
  requests,
  sender,
  attester,
  send,
  step = 'multiPublish',
  resumeAttemptId,
  hostNonceKey,
}: AttestedSend): Promise<{ attemptId: string; transactionHash: Hex }> {
  const serialized = JSON.stringify(requests, (_key, v) => (typeof v === 'bigint' ? v.toString() : v))
  const resumed = resumeAttemptId
    ? (await findOpenPublishAttempts([seedLocalId])).find((a) => a.id === resumeAttemptId)
    : undefined
  let attemptId: string
  let nonceKey: bigint | undefined
  if (resumed) {
    // The record reads this attempt's requests, so whichever send lands must have sent them.
    const same =
      resumed.step === step &&
      resumed.requests === serialized &&
      resumed.sender.toLowerCase() === sender.address.toLowerCase() &&
      resumed.entryPoint?.toLowerCase() === sender.pinsNonceOn?.toLowerCase()
    if (!same) throw new AttestationAttemptOpenError(seedLocalId, resumed)
    attemptId = resumed.id
    nonceKey = BigInt(resumed.nonceKey!)
  } else {
    attemptId = crypto.randomUUID()
    nonceKey =
      hostNonceKey !== undefined
        ? await usableHostNonceKey({ nonceKey: hostNonceKey, sender, directEas: step !== 'multiPublish' })
        : sender.pinsNonceOn
          ? nonceKeyForAttempt(attemptId)
          : undefined
    const fromBlock = await getPublishBlockNumber()
    const blockedBy = await claimPublishAttempt({
      id: attemptId,
      publishRunId: publishRunId ?? null,
      seedLocalId,
      seedLocalIds: [
        ...new Set([seedLocalId, ...requests.flatMap((r) => (r.localId ? [r.localId] : []))]),
      ],
      step,
      requests: serialized,
      sender: sender.address,
      attester,
      chainId: getPublishViemChain().id,
      nonceKey: nonceKey?.toString() ?? null,
      entryPoint: (sender.pinsNonceOn as Address | undefined) ?? null,
      fromBlock: fromBlock?.toString() ?? null,
    })
    if (blockedBy) throw new AttestationAttemptOpenError(seedLocalId, blockedBy)
  }

  let transactionHash: Hex
  let nonceKeyIgnored = false
  const unpin = async () => {
    if (!nonceKeyIgnored) return
    await updatePublishAttemptPin(attemptId)
    nonceKey = undefined
  }
  try {
    ;({ transactionHash } = await (nonceKey === undefined
      ? send(nonceKey)
      : send(nonceKey, () => {
          nonceKeyIgnored = true
        })))
  } catch (err) {
    await unpin()
    const status = attemptStatusAfterFailedSend(err)
    // A rejected resend says nothing about the first send, which may still be pending, and a used
    // pinned nonce can be this very send having landed.
    const inconclusive = status === 'notSent' && (resumed || (nonceKey !== undefined && isNonceTooLowError(err)))
    if (status && !inconclusive) await moveAttempt(attemptId, status)
    throw err
  }
  await unpin()
  await moveAttempt(attemptId, 'sent', transactionHash)
  return { attemptId, transactionHash }
}

/** Clears an attempt's nonce key and EntryPoint after a send that didn't use them. */
async function updatePublishAttemptPin(attemptId: string) {
  await updatePublishAttempt(attemptId, { nonceKey: null, entryPoint: null }).catch((err) => {
    logger('attempt %s keeps a nonce key its send did not use: %O', attemptId, err)
  })
}

/** Waits for a sent attempt's receipt. A lost receipt leaves the attempt open: it may still land. */
export async function waitForAttemptReceipt(attemptId: string, transactionHash: Hex) {
  try {
    const receipt = await waitForPublishReceipt(transactionHash)
    await moveAttempt(attemptId, 'landed')
    return receipt
  } catch (err) {
    if (err instanceof PublishTransactionRevertedError) await moveAttempt(attemptId, 'reverted')
    throw err
  }
}

/** The transaction's fate is already decided; a failed write must not replace the send's error. */
async function moveAttempt(attemptId: string, status: PublishAttemptStatus, txHash?: string) {
  await updatePublishAttempt(attemptId, { status, ...(txHash ? { txHash } : {}) }).catch((err) => {
    logger('attempt %s stays behind %s: %O', attemptId, status, err)
  })
}
