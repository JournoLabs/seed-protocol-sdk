import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { EventObject, fromCallback } from 'xstate'
import { eq, and, desc } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedProtocol:services:PublishManager:actors:savePublish')

/**
 * Multiple savePublish actors can be in flight per seed (subscribe + periodic + final).
 * SQLite writes complete in completion order, not invocation order — a slower stale write
 * can finish after the terminal save, miss the in_progress row (already completed), and
 * INSERT a new row with an intermediate snapshot. That makes UIs jump back to e.g.
 * creatingAttestations seconds after success. Serialize the actual DB work per seedLocalId.
 */
const saveWriteTailBySeed = new Map<string, Promise<void>>()

function enqueueSaveWrite(seedLocalId: string, write: () => Promise<void>): Promise<void> {
  const prev = saveWriteTailBySeed.get(seedLocalId) ?? Promise.resolve()
  const next = prev.then(write)
  saveWriteTailBySeed.set(seedLocalId, next.catch(() => {}))
  return next
}

export function isTerminalPublishRowStatus(
  status: string | null | undefined,
): status is 'completed' | 'failed' | 'interrupted' {
  return status === 'completed' || status === 'failed' || status === 'interrupted'
}

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

/** JSON.stringify cannot serialize BigInt; publish context (e.g. gas, tx fields) may contain bigint. */
function jsonStringifyPersistedSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v))
}

/** XState persisted snapshots usually have `context` at the root; some shapes nest it. */
function publishRunIdFromSnapshot(snapshot: unknown): string | undefined {
  if (snapshot == null || typeof snapshot !== 'object') return undefined
  const s = snapshot as Record<string, unknown>
  const nested = s.snapshot as { context?: { publishRunId?: string } } | undefined
  const ctx =
    (s.context as { publishRunId?: string } | undefined) ?? nested?.context
  const id = ctx?.publishRunId
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

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

export function markInProgressPublishInterrupted(seedLocalId: string): Promise<void> {
  return enqueueSaveWrite(seedLocalId, async () => {
    const db = BaseDb.getAppDb()
    if (!db) {
      logger('markInProgressPublishInterrupted: DB not ready, skipping')
      return
    }

    const existing = await db
      .select()
      .from(publishProcesses)
      .where(and(eq(publishProcesses.seedLocalId, seedLocalId), eq(publishProcesses.status, 'in_progress')))
      .orderBy(desc(publishProcesses.updatedAt))
      .limit(1)

    if (existing.length === 0) {
      return
    }

    const now = Date.now()
    await db
      .update(publishProcesses)
      .set({
        status: 'interrupted',
        completedAt: now,
        updatedAt: now,
        errorMessage: null,
        errorStep: null,
        errorDetails: null,
      })
      .where(eq(publishProcesses.id, existing[0].id!))
  })
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
      publishRunId?: string
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

    const snapshotStr =
      typeof persistedSnapshot === 'string' ? persistedSnapshot : jsonStringifyPersistedSnapshot(persistedSnapshot)
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
      // No in_progress row: either first save of a new run, or a stale async save after the row
      // was already moved to completed (INSERT would create a duplicate with a newer startedAt).
      const incomingRunId = publishRunIdFromSnapshot(snapshot)
      if (incomingRunId != null && status === 'in_progress' && snapshot.status !== 'done') {
        const latestAny = await db
          .select()
          .from(publishProcesses)
          .where(eq(publishProcesses.seedLocalId, seedLocalId))
          .orderBy(desc(publishProcesses.startedAt))
          .limit(1)
        const latest = latestAny[0]
        if (latest && isTerminalPublishRowStatus(latest.status)) {
          try {
            const prevParsed = JSON.parse(latest.persistedSnapshot) as unknown
            const terminalRunId = publishRunIdFromSnapshot(prevParsed)
            if (terminalRunId === incomingRunId) {
              logger(
                'savePublish: skip stale insert — same publishRunId as latest terminal row',
                seedLocalId,
                incomingRunId,
              )
              return
            }
          } catch {
            /* ignore parse errors; proceed with insert */
          }
        }
      }

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

  enqueueSaveWrite(seedLocalId, _save)
    .then(() => {
      sendBack({ type: 'SAVE_PUBLISH_DONE', seedLocalId, triggerPublishDone })
    })
    .catch((err) => {
      logger('savePublish error', err)
      sendBack({ type: 'SAVE_PUBLISH_DONE', seedLocalId, triggerPublishDone })
    })
})
