import { assign } from 'xstate'
import { savePublish } from '../actors/savePublish'

type PublishProcessActor = {
  getPersistedSnapshot?: () => unknown
  getSnapshot: () => { status?: string; value?: unknown; context?: Record<string, unknown> }
}

/** Never persist multi-megabyte binary fields to SQLite (periodic saves during bundler upload). */
const HEAVY_PUBLISH_CONTEXT_KEYS = ['signedDataItems', 'arweaveUploadData'] as const

/**
 * Never persist key material: an ethers HD wallet passed as `dataItemSigner` serializes its
 * mnemonic. A restored publish falls back to the PublishProvider config (`context.x ?? config.x`),
 * so the key must be configured again to sign after a reload.
 */
const SECRET_PUBLISH_CONTEXT_KEYS = ['dataItemSigner'] as const

const STRIPPED_KEYS = new Set<string>([...HEAVY_PUBLISH_CONTEXT_KEYS, ...SECRET_PUBLISH_CONTEXT_KEYS])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Child actor snapshots carry their `input` (`{ context }`), so the keys can appear anywhere in
 * the tree, not only on the root context. Walks plain objects and arrays; class instances
 * (Item, Uint8Array, …) are kept as they are.
 */
function stripPublishSnapshotFields(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value)
    const out: unknown[] = []
    seen.set(value, out)
    for (const v of value) out.push(stripPublishSnapshotFields(v, seen))
    return out
  }
  if (!isPlainObject(value)) return value
  if (seen.has(value)) return seen.get(value)
  const out: Record<string, unknown> = {}
  seen.set(value, out)
  for (const [k, v] of Object.entries(value)) {
    if (STRIPPED_KEYS.has(k)) continue
    out[k] = stripPublishSnapshotFields(v, seen)
  }
  return out
}

export function getPersistableSnapshot(actor: PublishProcessActor): unknown {
  try {
    const snap = actor.getPersistedSnapshot?.() ?? actor.getSnapshot()
    return stripPublishSnapshotFields(snap)
  } catch {
    const snapshot = actor.getSnapshot()
    const ctx = snapshot.context
    if (!ctx?.item) return stripPublishSnapshotFields(snapshot)
    const item = ctx.item as { seedLocalId?: string; modelName?: string; schemaId?: string }
    return stripPublishSnapshotFields({
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
