import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'

type UpdateSeedRevokedAtProps = {
  seedLocalId: string
  revokedAt: number
}

/**
 * Sets revokedAt timestamp on a seed record after attestations have been revoked on EAS.
 */
export const updateSeedRevokedAt = async ({
  seedLocalId,
  revokedAt,
}: UpdateSeedRevokedAtProps): Promise<void> => {
  if (!seedLocalId) {
    return
  }

  const appDb = BaseDb.getAppDb()

  await appDb
    .update(seeds)
    .set({
      revokedAt,
      updatedAt: Date.now(),
    })
    .where(eq(seeds.localId, seedLocalId))
}
