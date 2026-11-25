import { findPublishAttemptsByNonceKey } from '@seedprotocol/sdk'
import { AttestationOutcomeUnknownError } from '~/errors'
import type { PublishMachineContext } from '~/types'
import { publishNonceKey } from './pinnedNonce'

/** Attempt statuses that leave a transaction possibly in flight. */
const OPEN = new Set(['sending', 'sent', 'landed'])

/**
 * How many parts of a split publish went out under the host's `nonceKey` (ADR 0036): the run of
 * recorded `publish_attempts` rows that sent under `publishNonceKey(nonceKey, 1)`, `(…, 2)` and so
 * on, whichever run sent them, so a run that replaced another, or a reload, counts what came
 * before. The next part sends under the key derived for the part after them. Without a host
 * `nonceKey`, parts take keys from their attempt ids and the count doesn't matter, so this is 0 and
 * reads nothing.
 * A part `resumeAttemptId` names isn't counted: it is sent again under its own key.
 * @throws AttestationOutcomeUnknownError when a part under the key was sent and not settled: it may
 *   have landed, so the next one isn't sent until reconcile settles it
 */
export async function partsSentUnderNonceKey(
  context: Pick<PublishMachineContext, 'nonceKey' | 'resumeAttemptId'> & { item?: { seedLocalId?: string } },
): Promise<number> {
  const { nonceKey } = context
  if (nonceKey === undefined) return 0
  for (let parts = 0; ; parts++) {
    // The attempt a resume sends again is open by design; it sends under its own key.
    const rows = (await findPublishAttemptsByNonceKey(publishNonceKey(nonceKey, parts + 1).toString())).filter(
      (row) => row.id !== context.resumeAttemptId,
    )
    if (rows.some((row) => row.status === 'recorded')) continue
    const open = rows.find((row) => OPEN.has(row.status))
    if (open) {
      throw new AttestationOutcomeUnknownError(
        context.item?.seedLocalId ?? 'the item',
        open,
        open.txHash ? 'chainUnreadable' : 'noEvidence',
      )
    }
    return parts
  }
}
