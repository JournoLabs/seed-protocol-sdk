import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { createActor, EventObject, fromCallback } from 'xstate'
import { eq } from 'drizzle-orm'
import { publishMachine } from '../../publish'
import { subscribe } from './subscribe'
import { releasePublishLock, tryHoldPublishLock } from '../publishLocks'
import { markInProgressPublishInterrupted } from './savePublish'
import { isRestorableSnapshot, parkInterruptedAttestation, type PersistedSnapshot } from './restorableSnapshot'
import debug from 'debug'

const logger = debug('seedProtocol:services:PublishManager:actors:restoreFromDb')

const RESTORE_DB_WAIT_MS = 60_000
const RESTORE_DB_POLL_MS = 2_000

function envMs(name: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env[name] : undefined
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Polls with an unref'd timer: a host with no database must still be able to exit. */
async function waitForDb(maxWaitMs: number, pollMs: number, stopped?: () => boolean): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline && !stopped?.()) {
    try {
      if (BaseDb.isAppDbReady() && BaseDb.getAppDb()) return true
    } catch {
      // Db facade not configured yet
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, pollMs)
      ;(timer as { unref?: () => void }).unref?.()
    })
  }
  return false
}

/**
 * XState `persistContext` serializes actor refs as `{ xstate$$type: 1, id }`. `restoreSnapshot` swaps those
 * for live child actors; if the id is not in `snapshot.children`, `context.item` becomes `undefined` and
 * restored publishes throw on resume (e.g. createAttestations). Real item data is always a plain object.
 */
function isPersistedActorRef(value: unknown): value is { xstate$$type: number; id: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'xstate$$type' in value &&
    (value as { xstate$$type: number }).xstate$$type === 1 &&
    typeof (value as { id?: unknown }).id === 'string'
  )
}

function patchPublishContextItemForRestore(
  parsed: PersistedSnapshot,
  seedLocalId: string,
  record: { modelName?: string | null; schemaId?: string | null },
) {
  parsed.context = parsed.context ?? {}
  const raw = parsed.context.item
  if (isPersistedActorRef(raw)) {
    parsed.context.item = {
      seedLocalId,
      modelName: parsed.context.modelName ?? record.modelName ?? '',
      schemaId: parsed.context.schemaId ?? record.schemaId ?? undefined,
    }
    return
  }
  parsed.context.item = {
    ...(typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}),
    seedLocalId,
    modelName:
      (raw as { modelName?: string } | undefined)?.modelName ??
      parsed.context.modelName ??
      record.modelName ??
      '',
    schemaId:
      (raw as { schemaId?: string } | undefined)?.schemaId ??
      parsed.context.schemaId ??
      record.schemaId ??
      undefined,
  }
}

export interface RestoreFromDbInput {
  context: {
    publishProcesses: Map<string, unknown>
    subscriptions: Map<string, unknown>
  }
}

/** What became of restoring this tab's in-progress publishes. */
export type PublishRestoreStatus = {
  /**
   * `dbNotReady`: the database wasn't there in time, so nothing was restored yet; restore runs as
   * soon as it is. `failed`: restore threw, and in-progress publishes are not running here.
   */
  outcome: 'pending' | 'restored' | 'dbNotReady' | 'failed'
  error?: unknown
  /** Seeds whose saved publish can't be read, so it stays in progress and isn't running. */
  unreadableSeedLocalIds?: string[]
}

type RestoreResult = {
  publishProcesses: Map<string, import('xstate').ActorRef<any, any>>
  subscriptions: Map<string, import('xstate').ActorRef<any, EventObject>>
  status: PublishRestoreStatus
}

async function restorePublishes(context: RestoreFromDbInput['context'], dbReady: boolean): Promise<RestoreResult> {
  const newPublishProcesses = new Map<string, import('xstate').ActorRef<any, any>>()
  const newSubscriptions = new Map<string, import('xstate').ActorRef<any, EventObject>>()
  const result = (status: PublishRestoreStatus): RestoreResult => ({
    publishProcesses: newPublishProcesses,
    subscriptions: newSubscriptions,
    status,
  })
  if (!dbReady) return result({ outcome: 'dbNotReady' })

  const db = BaseDb.getAppDb()
  if (!db) return result({ outcome: 'dbNotReady' })

  const inProgress = await db
    .select()
    .from(publishProcesses)
    .where(eq(publishProcesses.status, 'in_progress'))

  // Dedupe by seedLocalId, keep latest per seedLocalId (by updatedAt then createdAt)
  const bySeed = new Map<string, (typeof inProgress)[0]>()
  const sorted = [...inProgress].sort(
    (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
  )
  for (const rec of sorted) {
    if (!bySeed.has(rec.seedLocalId)) bySeed.set(rec.seedLocalId, rec)
  }

  const unreadableSeedLocalIds: string[] = []
  for (const publishProcessRecord of bySeed.values()) {
    let parsed: PersistedSnapshot
    try {
      parsed = JSON.parse(publishProcessRecord.persistedSnapshot) as PersistedSnapshot
    } catch {
      unreadableSeedLocalIds.push(publishProcessRecord.seedLocalId)
      continue
    }
    if (parsed.status === 'done') continue
    const seedLocalId = parsed.context?.item?.seedLocalId ?? publishProcessRecord.seedLocalId
    if (!seedLocalId) continue
    // Started in this tab while the database was late: that run owns the row.
    if (context.publishProcesses.has(seedLocalId)) continue
    // Another open tab is already running this publish; it keeps it. Checked first: a publish
    // another tab is uploading looks unrestorable here, and must not be marked interrupted.
    if (!(await tryHoldPublishLock(seedLocalId))) continue
    if (!isRestorableSnapshot(parsed)) {
      // Can't resume: mark it interrupted so it doesn't stay in progress, and can be published again.
      await markInProgressPublishInterrupted(seedLocalId).catch(() => {})
      releasePublishLock(seedLocalId)
      continue
    }

    // Item is an SDK class instance; persistence loses getters. Also strip mistaken XState actor stubs on item.
    patchPublishContextItemForRestore(parsed, seedLocalId, publishProcessRecord)
    const reconcile = parkInterruptedAttestation(parsed)

    const publishProcess = createActor(publishMachine as unknown as import('xstate').AnyActorLogic, {
      snapshot: parsed as any,
      input: undefined,
    })

    const subscription = createActor(subscribe, {
      input: {
        publishProcess,
        seedLocalId,
      },
    })
    newPublishProcesses.set(seedLocalId, publishProcess)
    newSubscriptions.set(seedLocalId, subscription)

    publishProcess.start()
    subscription.start()
    if (reconcile) publishProcess.send({ type: 'retry' })
  }
  return result({
    outcome: 'restored',
    ...(unreadableSeedLocalIds.length > 0 ? { unreadableSeedLocalIds } : {}),
  })
}

function reportRestore(
  sendBack: (event: EventObject & Partial<RestoreResult>) => void,
  restore: () => Promise<RestoreResult | undefined>,
): void {
  restore()
    .catch((error): RestoreResult => {
      logger('restore failed: %O', error)
      return { publishProcesses: new Map(), subscriptions: new Map(), status: { outcome: 'failed', error } }
    })
    .then((result) => {
      if (result) sendBack({ type: 'RESTORE_FROM_DB_DONE', ...result })
    })
}

export const restoreFromDb = fromCallback<EventObject, RestoreFromDbInput>(({ sendBack, input }) => {
  // BaseDb is configured by platformClassesInit when client.init() runs.
  // PublishManager starts on module load, which can happen before client.init().
  // Wait for DB to be ready before attempting restore (poll every 2s, up to 60s).
  reportRestore(sendBack, async () => {
    const dbReady = await waitForDb(
      envMs('SEED_PUBLISH_RESTORE_WAIT_MS', RESTORE_DB_WAIT_MS),
      envMs('SEED_PUBLISH_RESTORE_POLL_MS', RESTORE_DB_POLL_MS),
    )
    return restorePublishes(input.context, dbReady)
  })
})

/**
 * Runs while the manager is active. When the first restore gave up on the database, it keeps
 * watching and restores once the database is there, whenever that is.
 */
export const restoreWhenDbReady = fromCallback<EventObject, RestoreFromDbInput & { status: PublishRestoreStatus }>(
  ({ sendBack, input }) => {
    if (input.status.outcome !== 'dbNotReady') return
    let stopped = false
    reportRestore(sendBack, async () => {
      await waitForDb(Infinity, envMs('SEED_PUBLISH_RESTORE_POLL_MS', RESTORE_DB_POLL_MS), () => stopped)
      return stopped ? undefined : restorePublishes(input.context, true)
    })
    return () => {
      stopped = true
    }
  },
)
