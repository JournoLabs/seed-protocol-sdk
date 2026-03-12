import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'

type UpdateSeedUidProps = {
  seedLocalId: string
  seedUid: string
  publisher?: string
}

/**
 * Updates seedUid and optionally publisher. Publisher is immutable once set:
 * we never overwrite an existing publisher (set at creation or from attestation).
 */
export const updateSeedUid = async ({
  seedLocalId,
  seedUid,
  publisher,
}: UpdateSeedUidProps): Promise<void> => {
  if (!seedLocalId || !seedUid) {
    return
  }

  const appDb = BaseDb.getAppDb()

  let shouldSetPublisher = publisher != null && publisher !== ''
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
      ...(shouldSetPublisher && { publisher }),
      updatedAt: Date.now(),
    })
    .where(eq(seeds.localId, seedLocalId))
}
