import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { and, inArray, isNull } from 'drizzle-orm'
import { writeInBatches } from '@/db/sqlParamBatches'

/**
 * Records property attestations publish revoked for a retraction (ADR 0021): their rows get
 * `revoked_at` and lose their value, as EAS sync stores a property revoked while its seed is live.
 * The cleared row that asked for the retraction stays the property's newest row.
 */
export const markPropertyAttestationsRetracted = async ({
  uids,
  revokedAt,
}: {
  uids: string[]
  /** Unix seconds. */
  revokedAt: number
}): Promise<void> => {
  const appDb = BaseDb.getAppDb()
  if (!appDb || uids.length === 0) return
  await writeInBatches(uids, (chunk) =>
    appDb
      .update(metadata)
      .set({
        revokedAt,
        propertyValue: null,
        refSeedType: null,
        refResolvedValue: null,
        refResolvedDisplayValue: null,
      })
      .where(and(inArray(metadata.uid, chunk), isNull(metadata.revokedAt))),
  )
}
