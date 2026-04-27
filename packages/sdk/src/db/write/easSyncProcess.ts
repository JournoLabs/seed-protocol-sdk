import { BaseDb } from '@/db/Db/BaseDb'
import { easSyncProcesses } from '@/seedSchema/EasSyncProcessSchema'
import { eq } from 'drizzle-orm'

let writeTail: Promise<unknown> = Promise.resolve()

function enqueueEasSyncDbWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeTail.then(fn)
  writeTail = next.catch(() => {}) as Promise<unknown>
  return next
}

const MAX_ERROR_MESSAGE_LENGTH = 500
const MAX_ERROR_DETAILS_LENGTH = 2000

export type EasSyncRequestSource = 'event_bus' | 'address_change' | 'client_api' | 'models_init'

export async function insertEasSyncProcessRow(params: {
  requestPayload: Record<string, unknown>
  persistedSnapshot: Record<string, unknown>
}): Promise<number> {
  return enqueueEasSyncDbWrite(async () => {
    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('[easSyncProcess] App DB not available')
    }
    const now = Date.now()
    const [row] = await db
      .insert(easSyncProcesses)
      .values({
        status: 'in_progress',
        startedAt: now,
        requestPayload: JSON.stringify(params.requestPayload),
        persistedSnapshot: JSON.stringify(params.persistedSnapshot),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: easSyncProcesses.id })
    return row.id
  })
}

export async function finalizeEasSyncProcessRow(
  id: number,
  params: {
    status: 'completed' | 'failed'
    errorMessage?: string
    errorDetails?: string
    persistedSnapshot: Record<string, unknown>
  },
): Promise<void> {
  return enqueueEasSyncDbWrite(async () => {
    const db = BaseDb.getAppDb()
    if (!db) {
      return
    }
    const now = Date.now()
    await db
      .update(easSyncProcesses)
      .set({
        status: params.status,
        completedAt: now,
        updatedAt: now,
        errorMessage: params.errorMessage?.slice(0, MAX_ERROR_MESSAGE_LENGTH) ?? null,
        errorDetails: params.errorDetails?.slice(0, MAX_ERROR_DETAILS_LENGTH) ?? null,
        persistedSnapshot: JSON.stringify(params.persistedSnapshot),
      })
      .where(eq(easSyncProcesses.id, id))
  })
}
