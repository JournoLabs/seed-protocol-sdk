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

  await appDb
    .update(seeds)
    .set({
      _markedForDeletion: 1,
    })
    .where(or(eq(seeds.localId, seedLocalId), eq(seeds.uid, seedUid)))
}
