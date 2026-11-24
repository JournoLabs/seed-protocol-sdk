import { findRecordedPublishAttempts, type PublishAttemptType } from '@seedprotocol/sdk'
import { LICENSE_OFFER_SCHEMA_UID } from '@seedprotocol/eas'
import type { Hex } from 'viem'
import { getPublishConfig } from '~/config'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getAttestedUidsFromReceipt } from '~/helpers/easDirect'

/** Whether the attempt's transaction carried the license offer of `seedLocalId`. */
function carriesOffer(attempt: PublishAttemptType, seedLocalId: string): boolean {
  const requests = JSON.parse(attempt.requests) as Array<{
    localId?: string
    licenseOffer?: boolean
    listOfAttestations?: Array<{ _licenseOffer?: boolean }>
  }>
  if (attempt.step === 'multiPublish') {
    return requests.some(
      (r) => r?.localId === seedLocalId && !!r.listOfAttestations?.some((a) => a?._licenseOffer === true),
    )
  }
  return attempt.step === 'properties' && requests[0]?.localId === seedLocalId && requests[0].licenseOffer === true
}

/**
 * The license offer (ADR 0039) for `seedLocalId` that run `publishRunId` already attested, read
 * from the receipt of its recorded attempt. Read from the rows rather than the run's saved state,
 * which a crash after the record can leave behind; a run that finds one doesn't send another.
 */
export async function recordedLicenseOfferUid(
  publishRunId: string | undefined,
  seedLocalId: string,
): Promise<string | undefined> {
  if (!publishRunId) return undefined
  for (const attempt of await findRecordedPublishAttempts(publishRunId)) {
    if (!attempt.txHash || !carriesOffer(attempt, seedLocalId)) continue
    const receipt = await waitForPublishReceipt(attempt.txHash as Hex)
    const offer = getAttestedUidsFromReceipt(receipt, getPublishConfig().easContractAddress, attempt.attester).find(
      (a) => a.schemaUid.toLowerCase() === LICENSE_OFFER_SCHEMA_UID.toLowerCase(),
    )
    if (offer) return offer.uid
  }
  return undefined
}
