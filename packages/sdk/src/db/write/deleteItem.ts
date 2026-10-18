import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq } from 'drizzle-orm'

type DeleteItemProps = {
  seedLocalId?: string
  seedUid?: string
}
type DeleteItem = (props: DeleteItemProps) => Promise<void>

/**
 * Soft-delete one seed row. Matches `seedLocalId` when given; `seeds.uid` isn't unique (a synced
 * seed and a local copy can share it), so `seedUid` is only used when there's no local id.
 */
export const deleteItem: DeleteItem = async ({ seedLocalId, seedUid }) => {
  const condition = seedLocalId
    ? eq(seeds.localId, seedLocalId)
    : seedUid
      ? eq(seeds.uid, seedUid)
      : undefined

  if (!condition) {
    return
  }

  await BaseDb.getAppDb()
    .update(seeds)
    .set({
      _markedForDeletion: 1,
    })
    .where(condition)
}
