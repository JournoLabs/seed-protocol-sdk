import { findOpenPublishAttempts } from '@seedprotocol/sdk'
import type { AttestationUnknownReason } from '~/errors'
import { settleOpenAttempts } from '../publish/settleOpenAttempts'
import { isHoldingPublishLock, publishLockHolder } from './publishLocks'

type OpenAttempt = Awaited<ReturnType<typeof findOpenPublishAttempts>>[number]

/** What `PublishManager.settleAttestationAttempt` found. */
export type AttestationSettleResult =
  /** No attempt is open for the seed any more: each was recorded or closed. */
  | { status: 'settled' }
  /** A run in this tab or another tab owns the seed's attempts; nothing was read. */
  | { status: 'running' }
  /** This attempt may have landed and the chain can't say; it stays open. */
  | { status: 'unknown'; attempt: OpenAttempt; reason: AttestationUnknownReason }

/**
 * Settles a seed's open attempts from the chain with no run, recording landed transactions with
 * `publisher` on the rows and closing reverted ones. Never sends. Refuses while `hasRun(seedLocalId)`
 * or a publish lock for the seed is held, here or in another tab.
 */
export async function settleAttestationAttempt(
  seedLocalId: string,
  publisher: string,
  hasRun: (seedLocalId: string) => boolean,
): Promise<AttestationSettleResult> {
  // Where Web Locks are missing publishLockHolder answers 'here' for every seed, so 'here' counts
  // only when this tab holds the lock.
  if (hasRun(seedLocalId) || isHoldingPublishLock(seedLocalId)) return { status: 'running' }
  if ((await publishLockHolder(seedLocalId)) === 'other-tab') return { status: 'running' }

  const result = await settleOpenAttempts({ seedLocalId, publishRunId: undefined, publisher })
  if (result.outcome === 'send') return { status: 'settled' }
  if (result.outcome === 'record') {
    throw new Error(`settleAttestationAttempt: ${seedLocalId} has an attempt only its own run can record`)
  }
  const { error } = result
  const attempt = (await findOpenPublishAttempts([seedLocalId])).find((a) => a.id === error.attemptId)
  if (!attempt) return { status: 'settled' }
  return { status: 'unknown', attempt, reason: error.reason }
}
