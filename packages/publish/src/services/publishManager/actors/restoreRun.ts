import { createActor, type EventObject } from 'xstate'
import { publishMachine } from '../../publish'
import { subscribe } from './subscribe'
import { releasePublishLock } from '../publishLocks'
import { markInProgressPublishInterrupted } from './savePublish'
import { isRestorableSnapshot, parkInterruptedAttestation, type PersistedSnapshot } from './restorableSnapshot'

// Kept apart from restoreFromDb so tests that replace that actor still restore runs (takeover.ts).

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

/** A `publish_processes` row as restore reads it. */
type PublishRowForRestore = {
  seedLocalId: string
  persistedSnapshot: string
  modelName?: string | null
  schemaId?: string | null
}

type ReadPublishRow = { parsed: PersistedSnapshot; seedLocalId: string }

/** The row's saved run, `undefined` when it finished, or `'unreadable'` when it doesn't parse. */
export function readPublishRow(record: PublishRowForRestore): ReadPublishRow | undefined | 'unreadable' {
  let parsed: PersistedSnapshot
  try {
    parsed = JSON.parse(record.persistedSnapshot) as PersistedSnapshot
  } catch {
    return 'unreadable'
  }
  if (parsed.status === 'done') return undefined
  const seedLocalId = parsed.context?.item?.seedLocalId ?? record.seedLocalId
  if (!seedLocalId) return undefined
  return { parsed, seedLocalId }
}

export type RestoredRun = {
  publishProcess: import('xstate').ActorRef<any, any>
  subscription: import('xstate').ActorRef<any, EventObject>
}

/**
 * Starts the saved run of a seed whose publish lock this tab holds. A run that can't resume is
 * marked interrupted, so it doesn't stay in progress and can be published again, and its lock is
 * let go; that gives `undefined`.
 */
export async function startRestoredRun(
  { parsed, seedLocalId }: ReadPublishRow,
  record: PublishRowForRestore,
): Promise<RestoredRun | undefined> {
  if (!isRestorableSnapshot(parsed)) {
    await markInProgressPublishInterrupted(seedLocalId).catch(() => {})
    releasePublishLock(seedLocalId)
    return undefined
  }

  // Item is an SDK class instance; persistence loses getters. Also strip mistaken XState actor stubs on item.
  patchPublishContextItemForRestore(parsed, seedLocalId, record)
  const reconcile = parkInterruptedAttestation(parsed)

  const publishProcess = createActor(publishMachine as unknown as import('xstate').AnyActorLogic, {
    snapshot: parsed as any,
    input: undefined,
  })
  const subscription = createActor(subscribe, { input: { publishProcess, seedLocalId } })

  publishProcess.start()
  subscription.start()
  if (reconcile) publishProcess.send({ type: 'retry' })
  return { publishProcess, subscription }
}

