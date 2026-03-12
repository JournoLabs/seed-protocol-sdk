import { BaseDb, publishProcesses } from '@seedprotocol/sdk'
import { createActor, EventObject, fromCallback } from 'xstate'
import { eq } from 'drizzle-orm'
import { publishMachine } from '../../publish'
import { subscribe } from './subscribe'

/** Minimal snapshot shape for restore; avoids excessive type recursion from SnapshotFrom<typeof publishMachine>. */
interface PersistedSnapshot {
  status?: string
  context?: {
    item?: { seedLocalId?: string; modelName?: string; schemaId?: string }
    modelName?: string
    schemaId?: string
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
      // Guard: skip restore if platform not yet initialized.
      if (!BaseDb.PlatformClass) {
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
