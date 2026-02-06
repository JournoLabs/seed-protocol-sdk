import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq, or } from 'drizzle-orm'

type DeleteItemProps = {
  seedLocalId?: string
  seedUid?: string
}
type DeleteItem = (props: DeleteItemProps) => Promise<void>
export const deleteItem: DeleteItem = async ({ seedLocalId, seedUid }) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deleteItem.ts:deleteItem',message:'deleteItem entered',data:{seedLocalId,seedUid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
  // #endregion
  const appDb = BaseDb.getAppDb()
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deleteItem.ts:deleteItem',message:'getAppDb',data:{hasAppDb:!!appDb},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
  // #endregion

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
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/0978b378-ebae-46bf-8fd3-134ef2e16cdd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'deleteItem.ts:deleteItem',message:'after update',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2'})}).catch(()=>{});
  // #endregion
}
