import { BaseDb, publishProcesses, uploadProcesses } from '@seedprotocol/sdk'
import { notInArray, eq } from 'drizzle-orm'

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
