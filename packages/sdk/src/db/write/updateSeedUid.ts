import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { normalizePublisher } from '@/helpers/addresses'

type UpdateSeedUidProps = {
  seedLocalId: string
  seedUid: string
  publisher?: string
  /** Unix ms when the seed attestation was created (EAS / chain time). */
  attestationCreatedAt?: number
}

/**
 * Updates seedUid and optionally publisher. Publisher is immutable once set:
 * we never overwrite an existing publisher (set at creation or from attestation).
 */
export const updateSeedUid = async ({
  seedLocalId,
  seedUid,
  publisher,
  attestationCreatedAt,
}: UpdateSeedUidProps): Promise<void> => {
  if (!seedLocalId || !seedUid) {
    return
  }

  const appDb = BaseDb.getAppDb()

  const normalizedPublisher = normalizePublisher(publisher)
  let shouldSetPublisher = normalizedPublisher != null
  if (shouldSetPublisher) {
    const [row] = await appDb
      .select({ publisher: seeds.publisher })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    if (row?.publisher != null && row.publisher !== '') {
      shouldSetPublisher = false
    }
  }

  await appDb
    .update(seeds)
    .set({
      uid: seedUid,
      ...(shouldSetPublisher && { publisher: normalizedPublisher }),
      ...(attestationCreatedAt != null && { attestationCreatedAt }),
      updatedAt: Date.now(),
    })
    .where(eq(seeds.localId, seedLocalId))
}
