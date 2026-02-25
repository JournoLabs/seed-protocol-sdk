import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq, or } from 'drizzle-orm'

export const recoverDeletedItem = async ({ seedLocalId, seedUid }: { seedLocalId: string, seedUid: string }) => {
  const appDb = BaseDb.getAppDb()

  await appDb
    .update(seeds)
    .set({
      _markedForDeletion: 0,
    })
    .where(or(eq(seeds.localId, seedLocalId), eq(seeds.uid, seedUid)))
}
