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

/** Minimal snapshot shape for restore; avoids excessive type recursion from SnapshotFrom<typeof publishMachine>. */
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

        // Item is an SDK class instance; JSON.stringify loses getters (e.g. seedLocalId).
        // Patch context.item so createAttestations has the data it needs for retry.
        parsed.context = parsed.context ?? {}
        parsed.context.item = {
          ...parsed.context.item,
          seedLocalId,
          modelName:
            parsed.context.item?.modelName ?? parsed.context.modelName ?? publishProcessRecord.modelName ?? '',
          schemaId: parsed.context.item?.schemaId ?? parsed.context.schemaId ?? publishProcessRecord.schemaId ?? undefined,
        }

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
