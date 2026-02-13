import { getDb } from "~/db";
import { FromCallbackInput, PublishManagerMachineContext } from "~/types/machines";
import { ActorRefFrom, createActor, EventObject, fromCallback, SnapshotFrom } from "xstate";
import { publishMachine } from "../../publish";
import { subscribe } from "./subscribe";

export const restoreFromDb = fromCallback<
EventObject,
FromCallbackInput<PublishManagerMachineContext>
>(({sendBack, input: {context},}) => {

  const db = getDb()

  const _restoreFromDb = async () => {

    const newPublishProcesses = new Map<string, ActorRefFrom<typeof publishMachine>>()
    const newSubscriptions = new Map<string, ActorRefFrom<typeof subscribe>>()

    const inProgress = await db.publishProcesses
      .where('status')
      .equals('in_progress')
      .toArray()

    // Dedupe by seedLocalId, keep latest per seedLocalId (by updatedAt then createdAt)
    const bySeed = new Map<string, typeof inProgress[0]>()
    const sorted = [...inProgress].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
    for (const rec of sorted) {
      if (!bySeed.has(rec.seedLocalId)) bySeed.set(rec.seedLocalId, rec)
    }
    const publishProcessRecords = Array.from(bySeed.values())

    for (const publishProcessRecord of publishProcessRecords) {
      let parsed: SnapshotFrom<typeof publishMachine>
      try {
        parsed = JSON.parse(publishProcessRecord.persistedSnapshot) as SnapshotFrom<typeof publishMachine>
      } catch {
        continue
      }
      if (parsed.status === 'done') continue
      const seedLocalId = parsed.context?.item?.seedLocalId
      if (!seedLocalId) continue

      const publishProcess = createActor(publishMachine, {
        snapshot: parsed,
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
    return {newPublishProcesses, newSubscriptions}
  }

  _restoreFromDb().then(({newPublishProcesses, newSubscriptions}) => {
    sendBack({type: 'RESTORE_FROM_DB_DONE', publishProcesses: newPublishProcesses, subscriptions: newSubscriptions})
  })
})
