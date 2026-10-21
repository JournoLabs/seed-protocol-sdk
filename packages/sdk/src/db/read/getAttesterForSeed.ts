import { findSeedRow } from '@/db/read/findSeedRow'
import { resolvePublisherFromSeedRow } from '@/helpers/ownership'

/**
 * Returns the attester address for a seed (from seeds.publisher or attestationRaw.attester).
 * Used when revoking attestations to determine which account must perform the revoke.
 *
 * @param seedLocalId - Optional seed local ID
 * @param seedUid - Optional seed UID (attestation ID); resolved as {@link findSeedRow} resolves it
 * @returns The attester address, or null if not found or no attester
 */
export async function getAttesterForSeed(params: {
  seedLocalId?: string
  seedUid?: string
}): Promise<string | null> {
  const row = await findSeedRow({ localId: params.seedLocalId, uid: params.seedUid })
  return row ? resolvePublisherFromSeedRow(row) : null
}
