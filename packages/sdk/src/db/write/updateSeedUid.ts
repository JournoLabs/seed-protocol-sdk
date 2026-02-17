import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'

type UpdateSeedUidProps = {
  seedLocalId: string
  seedUid: string
}

export const updateSeedUid = async ({
  seedLocalId,
  seedUid,
}: UpdateSeedUidProps): Promise<void> => {
  if (!seedLocalId || !seedUid) {
    return
  }

  const appDb = BaseDb.getAppDb()
  await appDb
    .update(seeds)
    .set({
      uid: seedUid,
      updatedAt: Date.now(),
    })
    .where(eq(seeds.localId, seedLocalId))
}
