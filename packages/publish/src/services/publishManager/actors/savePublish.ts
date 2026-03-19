import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { EventObject, fromCallback } from 'xstate'
import { eq, and, desc } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedProtocol:services:PublishManager:actors:savePublish')

function statusFromSnapshot(snapshot: { status?: string; value?: unknown }): 'in_progress' | 'completed' | 'failed' | 'interrupted' {
  if (snapshot.status === 'done') {
    if (snapshot.value === 'success') return 'completed'
    if (snapshot.value === 'failure') return 'failed'
    return 'completed'
  }
  return 'in_progress'
}

const MAX_ERROR_MESSAGE_LENGTH = 500
const MAX_ERROR_DETAILS_LENGTH = 2000

function errorFieldsFromContext(context: { error?: unknown; errorStep?: string } | undefined, status: 'in_progress' | 'completed' | 'failed' | 'interrupted') {
  if (!context?.error) return {}
  if (status !== 'failed' && status !== 'in_progress') return {}
  const err = context.error
  const errorMessage = err != null
    ? (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : undefined
  const errorStep = context.errorStep
  let errorDetails: string | undefined
  if (err instanceof Error && err.stack) {
    errorDetails = err.stack.slice(0, MAX_ERROR_DETAILS_LENGTH)
  } else if (err != null && typeof err === 'object') {
    try {
      errorDetails = JSON.stringify(err).slice(0, MAX_ERROR_DETAILS_LENGTH)
    } catch {
      errorDetails = String(err).slice(0, MAX_ERROR_DETAILS_LENGTH)
    }
  } else if (err != null) {
    errorDetails = String(err).slice(0, MAX_ERROR_DETAILS_LENGTH)
  }
  return { errorMessage: errorMessage ?? undefined, errorStep, errorDetails }
}

export const savePublish = fromCallback<
  EventObject & { seedLocalId?: string; triggerPublishDone?: boolean },
  { persistedSnapshot: unknown; seedLocalId: string; triggerPublishDone?: boolean }
>(({ sendBack, input: { persistedSnapshot, seedLocalId, triggerPublishDone } }) => {
  logger('savePublish seedLocalId', seedLocalId)
  const snapshot = persistedSnapshot as {
    status?: string
    value?: unknown
    context?: {
      modelName?: string
      schemaId?: string
      item?: { seedLocalId: string; seedUid?: string; modelName?: string; schemaId?: string }
      error?: unknown
      errorStep?: string
    }
  }

  const _save = async () => {
    const db = BaseDb.getAppDb()
    if (!db) {
      logger('savePublish: DB not ready, skipping')
      sendBack({ type: 'SAVE_PUBLISH_DONE', seedLocalId, triggerPublishDone })
      return
    }

    const existing = await db
      .select()
      .from(publishProcesses)
      .where(and(eq(publishProcesses.seedLocalId, seedLocalId), eq(publishProcesses.status, 'in_progress')))
      .orderBy(desc(publishProcesses.updatedAt))
      .limit(1)

    const snapshotStr = typeof persistedSnapshot === 'string' ? persistedSnapshot : JSON.stringify(persistedSnapshot)
    const status = statusFromSnapshot(snapshot)
    const now = Date.now()
    const errorFields = errorFieldsFromContext(snapshot.context, status)

    if (existing.length > 0) {
      const rec = existing[0]
      await db
        .update(publishProcesses)
        .set({
          persistedSnapshot: snapshotStr,
          status,
          updatedAt: now,
          ...(snapshot.status === 'done' && status !== 'in_progress' ? { completedAt: now } : {}),
          ...errorFields,
        })
        .where(eq(publishProcesses.id, rec.id!))
    } else {
      const item = snapshot.context?.item
      const modelName = snapshot.context?.modelName ?? item?.modelName ?? ''
      const schemaId = snapshot.context?.schemaId ?? item?.schemaId
      await db.insert(publishProcesses).values({
        seedLocalId,
        modelName,
        schemaId: schemaId ?? null,
        status,
        startedAt: now,
        persistedSnapshot: snapshotStr,
        createdAt: now,
        updatedAt: now,
        ...errorFields,
      })
    }
  }

  _save().then(() => {
    sendBack({ type: 'SAVE_PUBLISH_DONE', seedLocalId, triggerPublishDone })
  }).catch((err) => {
    logger('savePublish error', err)
    sendBack({ type: 'SAVE_PUBLISH_DONE', seedLocalId, triggerPublishDone })
  })
})
