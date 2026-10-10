import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { writeInBatches } from '@/db/sqlParamBatches'

type UpdateSeedRevokedAtProps = {
  seedLocalId: string
  /** Unix seconds. */
  revokedAt: number
  /**
   * Property attestation UIDs revoked along with the seed. Their metadata rows get the same
   * `revoked_at` (unless they already have one), so they read as revoked before the next sync.
   * Rows sync derived from them (ItemStorage rows whose `derived_from_uid` is one of these) are
   * stamped the same way.
   */
  metadataUids?: string[]
  /** Version attestation UIDs revoked along with the seed; their rows are stamped the same way. */
  versionUids?: string[]
}

/**
 * Sets revokedAt timestamp on a seed record after attestations have been revoked on EAS.
 */
export const updateSeedRevokedAt = async ({
  seedLocalId,
  revokedAt,
  metadataUids,
  versionUids,
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

  // An item can have many property attestations; each list binds once per uid (twice for metadata).
  await writeInBatches(metadataUids ?? [], (chunk) =>
    appDb
      .update(metadata)
      .set({ revokedAt, updatedAt: Date.now() })
      .where(
        and(
          or(inArray(metadata.uid, chunk), inArray(metadata.derivedFromUid, chunk)),
          isNull(metadata.revokedAt),
        ),
      ),
  )

  await writeInBatches(versionUids ?? [], (chunk) =>
    appDb
      .update(versions)
      .set({ revokedAt, updatedAt: Date.now() })
      .where(and(inArray(versions.uid, chunk), isNull(versions.revokedAt))),
  )
}
