import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { createActor, EventObject, fromCallback } from 'xstate'
import { eq } from 'drizzle-orm'
import { publishMachine } from '../../publish'
import { subscribe } from './subscribe'

const RESTORE_DB_WAIT_MS = 60_000
const RESTORE_DB_POLL_MS = 2_000

async function waitForDb(maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    if (BaseDb.PlatformClass && BaseDb.getAppDb()) return true
    await new Promise((r) => setTimeout(r, RESTORE_DB_POLL_MS))
  }
  return false
}

/** Minimal snapshot shape for restore; avoids excessive type recursion from SnapshotFrom<typeof publishMachine>.
 * Older rows may omit `context.attestationStrategy`; publish guards then fall back to `useDirectEas`. */
interface PersistedSnapshot {
  status?: string
  value?: string | Record<string, unknown>
  context?: {
    item?: { seedLocalId?: string; modelName?: string; schemaId?: string }
    modelName?: string
    schemaId?: string
    reimbursementTransactionId?: string
    requestResponse?: unknown
    arweaveTransactions?: unknown[]
    publishUploads?: unknown[]
  }
}

function getStateValue(parsed: PersistedSnapshot): string {
  const v = parsed.value
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    return (keys[0] ?? '') as string
  }
  return ''
}

function isRestorableSnapshot(parsed: PersistedSnapshot): boolean {
  const stateValue = getStateValue(parsed)
  if (stateValue === 'pollingForConfirmation') {
    if (!parsed.context?.reimbursementTransactionId || !parsed.context?.requestResponse) return false
  }
  if (stateValue === 'uploadingData') {
    const txs = parsed.context?.arweaveTransactions
    const uploads = parsed.context?.publishUploads
    if (!Array.isArray(txs) || txs.length === 0 || !Array.isArray(uploads)) return false
  }
  return true
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

export const restoreFromDb = fromCallback<EventObject, RestoreFromDbInput>(
  ({ sendBack, input: { context } }) => {
    const _restoreFromDb = async () => {
      const newPublishProcesses = new Map<string, import('xstate').ActorRef<any, any>>()
      const newSubscriptions = new Map<string, import('xstate').ActorRef<any, EventObject>>()

      // BaseDb.PlatformClass is set by platformClassesInit when client.init() runs.
      // PublishManager starts on module load, which can happen before client.init().
      // Wait for DB to be ready before attempting restore (poll every 2s, up to 60s).
      const dbReady = await waitForDb(RESTORE_DB_WAIT_MS)
      if (!dbReady) {
        sendBack({ type: 'RESTORE_FROM_DB_DONE', publishProcesses: newPublishProcesses, subscriptions: newSubscriptions })
        return { newPublishProcesses, newSubscriptions }
      }

      const db = BaseDb.getAppDb()
      if (!db) {
        sendBack({ type: 'RESTORE_FROM_DB_DONE', publishProcesses: newPublishProcesses, subscriptions: newSubscriptions })
        return { newPublishProcesses, newSubscriptions }
      }

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
      const publishProcessRecords = Array.from(bySeed.values())

      for (const publishProcessRecord of publishProcessRecords) {
        let parsed: PersistedSnapshot
        try {
          parsed = JSON.parse(publishProcessRecord.persistedSnapshot) as PersistedSnapshot
        } catch {
          continue
        }
        if (parsed.status === 'done') continue
        const seedLocalId = parsed.context?.item?.seedLocalId ?? publishProcessRecord.seedLocalId
        if (!seedLocalId) continue
        if (!isRestorableSnapshot(parsed)) continue

        // Item is an SDK class instance; persistence loses getters. Also strip mistaken XState actor stubs on item.
        patchPublishContextItemForRestore(parsed, seedLocalId, publishProcessRecord)

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
      }
      return { newPublishProcesses, newSubscriptions }
    }

    _restoreFromDb().then((result) => {
      if (!result) return
      const { newPublishProcesses, newSubscriptions } = result
      sendBack({
        type: 'RESTORE_FROM_DB_DONE',
        publishProcesses: newPublishProcesses,
        subscriptions: newSubscriptions,
      })
    })
  }
)
