import { assign } from 'xstate'
import { savePublish } from '../actors/savePublish'

type PublishProcessActor = {
  getPersistedSnapshot?: () => unknown
  getSnapshot: () => { status?: string; value?: unknown; context?: Record<string, unknown> }
}

function getPersistableSnapshot(actor: PublishProcessActor): unknown {
  try {
    return actor.getPersistedSnapshot?.() ?? actor.getSnapshot()
  } catch {
    const snapshot = actor.getSnapshot()
    const ctx = snapshot.context
    if (!ctx?.item) return snapshot
    const item = ctx.item as { seedLocalId?: string; modelName?: string; schemaId?: string }
    return {
      ...snapshot,
      context: {
        ...ctx,
        item: {
          seedLocalId: item.seedLocalId,
          modelName: item.modelName,
          schemaId: item.schemaId,
        },
      },
    }
  }
}

export const requestSavePublish = assign(({ context, event, spawn }) => {
  const { publishProcesses } = context
  const { seedLocalId, publishProcess, triggerPublishDone } = event as unknown as {
    seedLocalId: string
    publishProcess?: PublishProcessActor
    triggerPublishDone?: boolean
  }

  if (!publishProcess) {
    return context
  }

  const newPublishProcesses = new Map(publishProcesses)
  newPublishProcesses.set(seedLocalId, publishProcess)

  const persistedSnapshot = getPersistableSnapshot(publishProcess)

  spawn(savePublish, {
    id: `savePublish_${seedLocalId}_${Date.now()}`,
    input: { persistedSnapshot, seedLocalId, triggerPublishDone },
  })

  return { publishProcesses: newPublishProcesses }
})
