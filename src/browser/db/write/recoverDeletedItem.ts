import { getAppDb } from '@/browser/db/sqlWasmClient'
import { seeds } from '@/shared/seedSchema'
import { eq, or } from 'drizzle-orm'

export const recoverDeletedItem = async ({ seedLocalId, seedUid }) => {
  const appDb = getAppDb()

  await appDb
    .update(seeds)
    .set({
      _markedForDeletion: 0,
    })
    .where(or(eq(seeds.localId, seedLocalId), eq(seeds.uid, seedUid)))
}
