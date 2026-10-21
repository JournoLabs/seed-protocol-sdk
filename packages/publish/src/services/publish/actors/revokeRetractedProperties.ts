import { fromPromise } from 'xstate'
import type { PublishMachineContext } from '../../../types'

type RevokeInput = { input: { context: PublishMachineContext } }

/**
 * After the attestations: revokes the attestations of the item's retracted properties (ADR 0021).
 * A separate transaction from the attester; nothing to do when no property is retracted. Read again
 * on each run, so a retry sends only what is still live.
 */
export const revokeRetractedProperties = fromPromise(async ({ input: { context } }: RevokeInput): Promise<void> => {
  const { item } = context
  const seedLocalId = item?.seedLocalId
  const seedUid = item?.seedUid
  if (!seedLocalId || !seedUid) return
  const { getPendingRetractions } = await import('@seedprotocol/sdk')
  const retractions = await getPendingRetractions({ seedLocalId, seedUid })
  if (retractions.length === 0) return
  const { revokePropertyAttestations } = await import('../../revoke/revokeAttestations')
  await revokePropertyAttestations({
    seedLocalId,
    seedUid,
    attestations: retractions.flatMap((r) => r.attestations),
  })
})
