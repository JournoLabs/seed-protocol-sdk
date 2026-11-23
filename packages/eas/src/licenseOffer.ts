import { bytes32ToArweaveTxId } from './archiveAnchor.js'
import { LICENSE_OFFER_SCHEMA_UID, ZERO_BYTES32 } from './constants.js'
import { BaseEasClient } from './EasClient/BaseEasClient.js'
import { normalizeBytes32Hex } from './easUid.js'
import { indexerUid } from './indexerUid.js'
import { GET_PROPERTIES } from './queries.js'
import type { Attestation } from './graphql/gql/graphql.js'

/** A license offer as EAS reports it (ADR 0037). Fields for paid offers are not read yet. */
export type LicenseOffer = {
  uid: string
  attester: string
  /** The Version the offer refers to. */
  versionUid: string
  /** Unix seconds. */
  timeCreated: number
  /** Unix seconds; 0 while it is live. */
  revocationTime: number
  /** `0x` and 64 lowercase hex digits. */
  termsHash: string
  spdx: string
  /** Arweave transaction id of the legal text; absent when the offer names none. */
  legalTxId?: string
}

/** Version uids per request, as getAttestationChangesSince splits them. */
const VERSION_UIDS_PER_REQUEST = 400

type DecodedField = { name?: string; value?: { value?: unknown } }

function decodeOffer(attestation: Attestation): LicenseOffer | undefined {
  try {
    const fields = JSON.parse(attestation.decodedDataJson) as DecodedField[]
    const field = (name: string) => fields.find((f) => f.name === name)?.value?.value
    const termsHash = normalizeBytes32Hex(String(field('terms_hash')))
    const spdx = field('spdx')
    if (!termsHash || typeof spdx !== 'string' || spdx.trim() === '') return undefined
    const legalTx = normalizeBytes32Hex(String(field('legal_tx')))
    return {
      uid: attestation.id,
      attester: attestation.attester,
      versionUid: attestation.refUID,
      timeCreated: attestation.timeCreated,
      revocationTime: attestation.revoked ? attestation.revocationTime : 0,
      termsHash,
      spdx,
      ...(legalTx && legalTx !== ZERO_BYTES32 ? { legalTxId: bytes32ToArweaveTxId(legalTx) } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * The offers on `versionUids` from `attester`, the Seed's attester: anyone can attest with any
 * refUID. Revoked ones included, since a revocation is part of the license history. Oldest first.
 * Not cached, so every read sees what the indexer has now.
 */
export async function getLicenseOffersFromEas({
  versionUids,
  attester,
}: {
  versionUids: readonly string[]
  attester: string
}): Promise<LicenseOffer[]> {
  const unique = [...new Set(versionUids.map(indexerUid))].sort()
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += VERSION_UIDS_PER_REQUEST) chunks.push(unique.slice(i, i + VERSION_UIDS_PER_REQUEST))
  const responses = await Promise.all(
    chunks.map(
      (chunk) =>
        BaseEasClient.getEasClient().request(GET_PROPERTIES, {
          where: { refUID: { in: chunk }, schemaId: { equals: LICENSE_OFFER_SCHEMA_UID } },
        }) as Promise<{ itemProperties: Attestation[] }>,
    ),
  )
  return responses
    .flatMap((r) => r.itemProperties)
    .filter((a) => a.attester.toLowerCase() === attester.toLowerCase())
    .map(decodeOffer)
    .filter((offer): offer is LicenseOffer => !!offer)
    .sort((a, b) => a.timeCreated - b.timeCreated)
}
