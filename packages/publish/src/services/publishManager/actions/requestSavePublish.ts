import { assign } from 'xstate'
import { savePublish } from '../actors/savePublish'

type PublishProcessActor = {
  getPersistedSnapshot?: () => unknown
  getSnapshot: () => { status?: string; value?: unknown; context?: Record<string, unknown> }
}

/** Never persist multi-megabyte binary fields to SQLite (periodic saves during bundler upload). */
const HEAVY_PUBLISH_CONTEXT_KEYS = ['signedDataItems', 'arweaveUploadData'] as const

function stripHeavyContextFields(
  ctx: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (ctx == null || typeof ctx !== 'object') return ctx
  const next = { ...ctx }
  for (const k of HEAVY_PUBLISH_CONTEXT_KEYS) {
    delete next[k]
  }
  return next
}

function stripHeavyPublishSnapshot(snapshot: unknown): unknown {
  if (snapshot == null || typeof snapshot !== 'object') return snapshot
  const s = snapshot as Record<string, unknown>
  const out: Record<string, unknown> = { ...s }
  if (s.context != null && typeof s.context === 'object') {
    out.context = stripHeavyContextFields(s.context as Record<string, unknown>)
  }
  const nested = s.snapshot
  if (nested != null && typeof nested === 'object') {
    const n = nested as Record<string, unknown>
    const nestedOut: Record<string, unknown> = { ...n }
    if (n.context != null && typeof n.context === 'object') {
      nestedOut.context = stripHeavyContextFields(n.context as Record<string, unknown>)
    }
    out.snapshot = nestedOut
  }
  return out
}

function getPersistableSnapshot(actor: PublishProcessActor): unknown {
  try {
    const snap = actor.getPersistedSnapshot?.() ?? actor.getSnapshot()
    return stripHeavyPublishSnapshot(snap)
  } catch {
    const snapshot = actor.getSnapshot()
    const ctx = snapshot.context
    if (!ctx?.item) return stripHeavyPublishSnapshot(snapshot)
    const item = ctx.item as { seedLocalId?: string; modelName?: string; schemaId?: string }
    return stripHeavyPublishSnapshot({
      ...snapshot,
      context: {
        ...ctx,
        item: {
          seedLocalId: item.seedLocalId,
          modelName: item.modelName,
          schemaId: item.schemaId,
        },
      },
    })
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
