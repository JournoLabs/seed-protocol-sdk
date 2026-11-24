import { findRecordedPublishAttempts, type PublishAttemptType } from '@seedprotocol/sdk'
import { LICENSE_OFFER_SCHEMA_UID } from '@seedprotocol/eas'
import type { Hex } from 'viem'
import { getPublishConfig } from '~/config'
import { easAbi } from '~/helpers/abi/eas'
import { getPublishPublicClient, waitForPublishReceipt } from '~/helpers/chainClient'
import { getAttestedUidsFromReceipt } from '~/helpers/easDirect'
import { encodeLicenseOfferData, type LicenseOfferInput } from '../../licenseOffer'

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

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The license offer (ADR 0039) on `seedLocalId` that a publish would repeat: the newest offer
 * `attester` attested on the Seed, from any run, when it is live and has the same terms as `offer`.
 * Read from the recorded attempts, which a crash can leave ahead of a run's saved state, and from
 * EAS for the offer's terms and revocation. An offer on any Version counts for the whole Seed, so
 * repeating the newest one changes nothing a reader sees; a run that finds one doesn't send another.
 * An offer with other terms, or a revoked one, is a change the new offer has to make.
 */
export async function recordedLicenseOfferUid({
  seedLocalId,
  offer,
  attester,
}: {
  seedLocalId: string
  offer: LicenseOfferInput
  attester: string
}): Promise<string | undefined> {
  const attempts = await findRecordedPublishAttempts([seedLocalId])
  const newest = attempts
    .reverse()
    .find((a) => !!a.txHash && sameAddress(a.attester, attester) && carriesOffer(a, seedLocalId))
  if (!newest) return undefined
  const receipt = await waitForPublishReceipt(newest.txHash as Hex)
  const uid = getAttestedUidsFromReceipt(receipt, getPublishConfig().easContractAddress, newest.attester).find(
    (a) => a.schemaUid.toLowerCase() === LICENSE_OFFER_SCHEMA_UID.toLowerCase(),
  )?.uid
  if (!uid) return undefined
  const onChain = (await getPublishPublicClient().readContract({
    address: getPublishConfig().easContractAddress as Hex,
    abi: easAbi,
    functionName: 'getAttestation',
    args: [uid as Hex],
  })) as { uid: Hex; attester: Hex; revocationTime: bigint; data: Hex }
  const repeats =
    onChain.uid.toLowerCase() === uid.toLowerCase() &&
    sameAddress(onChain.attester, attester) &&
    onChain.revocationTime === 0n &&
    onChain.data.toLowerCase() === encodeLicenseOfferData(offer).toLowerCase()
  return repeats ? uid : undefined
}
