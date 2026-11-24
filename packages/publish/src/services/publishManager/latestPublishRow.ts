import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { desc, eq } from 'drizzle-orm'

export type LatestPublishRow = { status: string; persistedSnapshot: string; completedAt?: number | null }

/**
 * The seed's most recently started `publish_processes` row, which every tab of the origin shares.
 * `undefined` when there is none or the app database isn't ready.
 */
export async function latestPublishRow(seedLocalId: string): Promise<LatestPublishRow | undefined> {
  if (!BaseDb.isAppDbReady()) return undefined
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  const [row] = await db
    .select()
    .from(publishProcesses)
    .where(eq(publishProcesses.seedLocalId, seedLocalId))
    .orderBy(desc(publishProcesses.startedAt))
    .limit(1)
  return row as LatestPublishRow | undefined
}
