import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { withDbTabLock } from '@/helpers/tabCoordinator'

const KEY = 'excludedTransactions'

/**
 * Adds transaction ids to the `excludedTransactions` app_state list (txs no gateway could serve).
 * Reads, merges and writes under a cross-tab lock: writing a whole list read earlier lost the ids
 * another tab or download had added in between.
 */
export async function addExcludedTransactions(transactionIds: Iterable<string>): Promise<void> {
  const additions = [...transactionIds]
  if (additions.length === 0) return

  await withDbTabLock('excluded-transactions', async () => {
    const appDb = BaseDb.getAppDb()
    const rows = await appDb.select().from(appState).where(eq(appState.key, KEY)).limit(1)

    const merged = new Set<string>()
    try {
      for (const id of JSON.parse(rows[0]?.value ?? '[]') as string[]) merged.add(id)
    } catch {
      // Unreadable list: start over with the new ids.
    }
    const sizeBefore = merged.size
    for (const id of additions) merged.add(id)
    if (merged.size === sizeBefore && rows.length > 0) return

    const value = JSON.stringify([...merged])
    await appDb
      .insert(appState)
      .values({ key: KEY, value })
      .onConflictDoUpdate({ target: appState.key, set: { value } })
  })
}
