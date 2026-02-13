import { getDb } from "~/db";
import { EventObject, fromCallback } from "xstate";
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
  if (status !== 'failed' || !context) return {}
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
EventObject,
{ persistedSnapshot: unknown; seedLocalId: string }
>(({sendBack, input: {persistedSnapshot, seedLocalId}}) => {
  logger('savePublish seedLocalId', seedLocalId)
  const db = getDb()
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
    await db.transaction('rw', db.publishProcesses, async () => {
      const existing = await db.publishProcesses
        .where('seedLocalId')
        .equals(seedLocalId)
        .filter((r) => r.status === 'in_progress')
        .reverse()
        .sortBy('updatedAt')
        .then((rows) => rows[0])

      const snapshotStr = typeof persistedSnapshot === 'string' ? persistedSnapshot : JSON.stringify(persistedSnapshot)
      const status = statusFromSnapshot(snapshot)
      const now = Date.now()
      const errorFields = errorFieldsFromContext(snapshot.context, status)

      if (existing) {
        await db.publishProcesses.update(existing.id!, {
          persistedSnapshot: snapshotStr,
          status,
          updatedAt: now,
          ...(snapshot.status === 'done' && status !== 'in_progress' ? { completedAt: now } : {}),
          ...errorFields,
        })
      } else {
        const item = snapshot.context?.item
        const modelName = snapshot.context?.modelName ?? item?.modelName ?? ''
        const schemaId = snapshot.context?.schemaId ?? item?.schemaId
        await db.publishProcesses.add({
          seedLocalId,
          modelName,
          schemaId,
          status,
          startedAt: now,
          persistedSnapshot: snapshotStr,
          createdAt: now,
          updatedAt: now,
          ...errorFields,
        })
      }
    })
  }

  _save().then(() => {
    sendBack({type: 'SAVE_PUBLISH_DONE'})
  })
})
