import { findSeedRow } from '@/db/read/findSeedRow'
import { isVersionRevoked } from './subqueries/liveVersion'

/**
 * True when the item's seed attestation was revoked (`seeds.revoked_at` set, by unpublish or EAS
 * sync). Such a seed can't take new versions: publishing again creates a new seed attestation
 * (see "Republishing" in docs/ATTESTATION_REVOCATION.md).
 */
export const isSeedRevoked = async (seedLocalId: string | undefined): Promise<boolean> => {
  if (!seedLocalId) return false
  const row = await findSeedRow({ localId: seedLocalId })
  return isVersionRevoked(row?.revokedAt)
}
