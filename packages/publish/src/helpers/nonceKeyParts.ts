import { findPublishAttemptsByNonceKey } from '@seedprotocol/sdk'
import { AttestationOutcomeUnknownError, PublishNonceKeyError } from '~/errors'
import type { PublishMachineContext } from '~/types'
import { publishNonceKey } from './pinnedNonce'

/** Attempt statuses that leave a transaction possibly in flight. */
const OPEN = new Set(['sending', 'sent', 'landed'])

/** Whether a stored part's requests include the request of the item being published. */
function holdsRoot(requests: string, seedLocalId: string): boolean {
  try {
    return (JSON.parse(requests) as Array<{ localId?: string }>).some((r) => r?.localId === seedLocalId)
  } catch {
    return false
  }
}

/**
 * How many parts of a split publish went out under the host's `nonceKey` (ADR 0036): the run of
 * recorded `publish_attempts` rows that sent under `publishNonceKey(nonceKey, 1)`, `(…, 2)` and so
 * on, whichever run sent them, so a run that replaced another, or a reload, counts what came
 * before. The next part sends under the key derived for the part after them. Without a host
 * `nonceKey`, parts take keys from their attempt ids and the count doesn't matter, so this is 0 and
 * reads nothing.
 * A part `resumeAttemptId` names isn't counted: it is sent again under its own key.
 * @throws PublishNonceKeyError `NONCE_KEY_SPENT` when the recorded parts include the one that held the
 *   item's own request: that key already finished a publish of it
 * @throws AttestationOutcomeUnknownError when a part under the key was sent and not settled: it may
 *   have landed, so the next one isn't sent until reconcile settles it
 */
export async function partsSentUnderNonceKey(
  context: Pick<PublishMachineContext, 'nonceKey' | 'resumeAttemptId'> & { item?: { seedLocalId?: string } },
): Promise<number> {
  const { nonceKey } = context
  const seedLocalId = context.item?.seedLocalId
  if (nonceKey === undefined) return 0
  for (let parts = 0; ; parts++) {
    // The attempt a resume sends again is open by design; it sends under its own key.
    // Only this item's publish counts: another item sent under the same host key isn't its parts.
    const rows = (await findPublishAttemptsByNonceKey(publishNonceKey(nonceKey, parts + 1).toString())).filter(
      (row) => row.id !== context.resumeAttemptId && (!seedLocalId || row.seedLocalId === seedLocalId),
    )
    const done = rows.find((row) => row.status === 'recorded')
    if (done) {
      // The part that held the item's own request is the last one: the publish finished under this key.
      if (seedLocalId && holdsRoot(done.requests, seedLocalId)) {
        throw new PublishNonceKeyError(
          'This nonceKey already finished a publish of this item, so it can\'t send another. ' +
            'A new publish needs a new nonceKey.',
          'NONCE_KEY_SPENT',
          nonceKey,
        )
      }
      continue
    }
    const open = rows.find((row) => OPEN.has(row.status))
    if (open) {
      throw new AttestationOutcomeUnknownError(
        seedLocalId ?? 'the item',
        open,
        open.txHash ? 'chainUnreadable' : 'noEvidence',
      )
    }
    return parts
  }
}
