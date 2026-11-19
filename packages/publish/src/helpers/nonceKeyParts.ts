import { countRecordedPublishParts } from '@seedprotocol/sdk'
import type { PublishMachineContext } from '~/types'

/**
 * How many parts of a split publish went out under the host's `nonceKey` (ADR 0036): those the runs
 * this one replaced recorded under the same key, plus those this run recorded. The next part sends
 * under the key derived for the part after them. Without a host `nonceKey`, parts take keys from
 * their attempt ids and the count doesn't matter, so this is 0 and reads nothing.
 */
export async function partsSentUnderNonceKey(
  context: Pick<PublishMachineContext, 'nonceKey' | 'publishRunId' | 'nonceKeyPartsInherited'>,
): Promise<number> {
  if (context.nonceKey === undefined) return 0
  const own = context.publishRunId ? await countRecordedPublishParts([context.publishRunId]) : 0
  return (context.nonceKeyPartsInherited ?? 0) + own
}
