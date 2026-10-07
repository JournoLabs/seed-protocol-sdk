import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds } from '@/seedSchema'
import { and, eq, inArray, isNull } from 'drizzle-orm'

type UpdateSeedRevokedAtProps = {
  seedLocalId: string
  /** Unix seconds. */
  revokedAt: number
  /**
   * Property attestation UIDs revoked along with the seed. Their metadata rows get the same
   * `revoked_at` (unless they already have one), so they read as revoked before the next sync.
   */
  metadataUids?: string[]
}

/**
 * Sets revokedAt timestamp on a seed record after attestations have been revoked on EAS.
 */
export const updateSeedRevokedAt = async ({
  seedLocalId,
  revokedAt,
  metadataUids,
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

  if (metadataUids && metadataUids.length > 0) {
    await appDb
      .update(metadata)
      .set({ revokedAt, updatedAt: Date.now() })
      .where(and(inArray(metadata.uid, metadataUids), isNull(metadata.revokedAt)))
  }
}
