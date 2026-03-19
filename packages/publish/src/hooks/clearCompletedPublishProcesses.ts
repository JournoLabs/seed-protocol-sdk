import { BaseDb, publishProcesses, uploadProcesses } from '@seedprotocol/sdk'
import { notInArray, eq, inArray } from 'drizzle-orm'

export async function clearCompletedPublishProcesses(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return

  await db
    .delete(publishProcesses)
    .where(notInArray(publishProcesses.status, ['in_progress']))
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
