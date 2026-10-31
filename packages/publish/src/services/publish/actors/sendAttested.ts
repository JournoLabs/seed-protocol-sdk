import { claimPublishAttempt, updatePublishAttempt, type PublishAttemptStatus } from '@seedprotocol/sdk'
import debug from 'debug'
import type { Hex } from 'viem'
import { AttestationAttemptOpenError, isManagedAccountPublishError, PublishTransactionRevertedError } from '~/errors'
import { getPublishBlockNumber, waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishViemChain } from '~/helpers/chainConfig'
import { isNonceTooLowError } from '~/helpers/retryNonceTooLow'

const logger = debug('seedProtocol:services:publish:actors:sendAttested')

const errorChain = (err: unknown): unknown[] => {
  const chain: unknown[] = []
  for (let cur = err; cur && chain.length < 8; cur = (cur as { cause?: unknown }).cause) chain.push(cur)
  return chain
}

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
  sender: string
  attester: string
  send: () => Promise<{ transactionHash: Hex }>
}

/**
 * The one way an attestation transaction goes out: commits an attempt row first, and refuses when
 * an open attempt covers any of these seeds, whichever run, retry or restore got here.
 * @throws AttestationAttemptOpenError when an open attempt is in the way; nothing was sent
 * @throws whatever `send` throws, after closing the attempt when that error settles what happened
 */
export async function sendAttested({
  publishRunId,
  seedLocalId,
  requests,
  sender,
  attester,
  send,
}: AttestedSend): Promise<{ attemptId: string; transactionHash: Hex }> {
  const attemptId = crypto.randomUUID()
  const fromBlock = await getPublishBlockNumber()
  const seedLocalIds = [
    ...new Set([seedLocalId, ...requests.flatMap((r) => (r.localId ? [r.localId] : []))]),
  ]
  const blockedBy = await claimPublishAttempt({
    id: attemptId,
    publishRunId: publishRunId ?? null,
    seedLocalId,
    seedLocalIds,
    step: 'multiPublish',
    requests: JSON.stringify(requests, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
    sender,
    attester,
    chainId: getPublishViemChain().id,
    nonceKey: null,
    fromBlock: fromBlock?.toString() ?? null,
  })
  if (blockedBy) throw new AttestationAttemptOpenError(seedLocalId, blockedBy)

  let transactionHash: Hex
  try {
    ;({ transactionHash } = await send())
  } catch (err) {
    const status = attemptStatusAfterFailedSend(err)
    if (status) await moveAttempt(attemptId, status)
    throw err
  }
  await moveAttempt(attemptId, 'sent', transactionHash)
  return { attemptId, transactionHash }
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
