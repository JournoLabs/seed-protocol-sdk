import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq, or } from 'drizzle-orm'

type DeleteItemProps = {
  seedLocalId?: string
  seedUid?: string
}
type DeleteItem = (props: DeleteItemProps) => Promise<void>
export const deleteItem: DeleteItem = async ({ seedLocalId, seedUid }) => {
  const appDb = BaseDb.getAppDb()

  const conditions = []
  if (seedLocalId) {
    conditions.push(eq(seeds.localId, seedLocalId))
  }
  if (seedUid) {
    conditions.push(eq(seeds.uid, seedUid))
  }

  if (conditions.length === 0) {
    return
  }

  await appDb
    .update(seeds)
    .set({
      _markedForDeletion: 1,
    })
    .where(or(...conditions))
}
