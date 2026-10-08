import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { isVersionRevoked } from './subqueries/liveVersion'

/**
 * True when the item's seed attestation was revoked (`seeds.revoked_at` set, by unpublish or EAS
 * sync). Such a seed can't take new versions: publishing again creates a new seed attestation
 * (see "Republishing" in docs/ATTESTATION_REVOCATION.md).
 */
export const isSeedRevoked = async (seedLocalId: string | undefined): Promise<boolean> => {
  if (!seedLocalId) return false
  const appDb = BaseDb.getAppDb()
  if (!appDb) return false
  const [row] = await appDb
    .select({ revokedAt: seeds.revokedAt })
    .from(seeds)
    .where(eq(seeds.localId, seedLocalId))
    .limit(1)
  return isVersionRevoked(row?.revokedAt)
}
