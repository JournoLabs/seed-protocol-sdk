import { BaseDb, publishProcesses, uploadProcesses } from '@seedprotocol/sdk'
import { and, notInArray, eq, inArray } from 'drizzle-orm'

/** Remove every publish_processes row whose status is not `in_progress` (app-wide). */
export async function clearCompletedPublishProcesses(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  await db
    .delete(publishProcesses)
    .where(notInArray(publishProcesses.status, ['in_progress']))
}

/**
 * Same semantics as {@link clearCompletedPublishProcesses}, but only for rows with the given
 * `seedLocalId`. Never deletes `in_progress` runs for that seed.
 */
export async function clearCompletedPublishProcessesForSeed(seedLocalId: string): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  await db
    .delete(publishProcesses)
    .where(
      and(eq(publishProcesses.seedLocalId, seedLocalId), notInArray(publishProcesses.status, ['in_progress']))
    )
}

export async function clearAllPublishProcesses(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  await db.delete(publishProcesses)
}

export async function clearAllUploadProcesses(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  await db.delete(uploadProcesses)
}

/**
 * Deletes **all** `publish_processes` rows for this seed (full history, including any
 * `in_progress` run). For removing individual runs, use {@link deletePublishProcessById} or
 * {@link deletePublishProcessesByIds}.
 */
export async function deletePublishProcessesForSeed(seedLocalId: string): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  await db.delete(publishProcesses).where(eq(publishProcesses.seedLocalId, seedLocalId))
}

/** Delete a single publish process record by id. */
export async function deletePublishProcessById(id: number): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  await db.delete(publishProcesses).where(eq(publishProcesses.id, id))
}

/** Delete multiple publish process records by ids. */
export async function deletePublishProcessesByIds(ids: number[]): Promise<void> {
  if (ids.length === 0) return
  const db = BaseDb.getAppDb()
  if (!db) return
  await db.delete(publishProcesses).where(inArray(publishProcesses.id, ids))
}
