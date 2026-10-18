/**
 * The appliers for item ops (ADR 0019). Every tab registers them at init: the leader applies ops
 * that other tabs appended.
 */
import { and, eq, or } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { createSeed, type NewSeedFields } from '@/db/write/createSeed'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata } from '@/db/write/createMetadata'
import { metadata, type MetadataType } from '@/seedSchema'
import type { PropertyType } from '@/types'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { outboxOpValue, registerOutboxApplier, startOutbox, type OutboxOp } from './outbox'

/**
 * A plain value (Text, Number, Boolean, Date, List, a Relation's seed id) for one item property,
 * as `updateItemPropertyValue` takes it: the value already in its stored string form, and the
 * schema uid already resolved (applying runs in a transaction and mustn't wait on EAS).
 */
export type SetPropertyValueOp = {
  newValue: string | null
  /** The property's metadata row the edit was made against, if it had one. */
  localId?: string | null
  versionLocalId?: string | null
  versionUid?: string | null
  modelName?: string | null
  schemaUid?: string | null
  dataType?: string
  refValueType?: string
}

/** The row a `set` op wrote (updateItemPropertyValue's result). */
export type SetPropertyValueResult = {
  localId: string
  uid: string | null
  schemaUid: string
} | null

/**
 * An Html, File or Image value: a new storage seed whose file is already written (named after the
 * seed, so nothing else uses it), and the property row that points at it. Applying it creates the
 * storage seed and its version and writes the row, all in the op's transaction.
 */
export type StorageValueOp = {
  storageSeed: {
    /** Chosen when the file was written, so the file could be named after it. */
    localId: string
    type: 'html' | 'file' | 'image'
    modelFileId: string
    fields: NewSeedFields
  }
  /** The file written for this value, deleted if the op never applies. Absent for a reference to a file that was already there. */
  ownedFilePath?: string
  /** The row when the property has none yet (createMetadata). */
  create: { values: Partial<MetadataType> & { modelName?: string }; propertyRecordSchema?: PropertyType }
  /** The update when it has one (updateItemPropertyValue); its `localId` is filled in when applied. */
  update: Record<string, unknown>
}

/**
 * Writes a storage value's rows on `db`. The property's row is looked up here, on `db`, rather than
 * taken from the edit: two quick edits of a property that had no row would otherwise both create one.
 */
export async function applyStorageValue(
  seedLocalId: string,
  propertyName: string,
  value: StorageValueOp,
  db: ReturnType<typeof BaseDb.getAppDb>,
): Promise<SetPropertyValueResult> {
  const { storageSeed } = value
  await createSeed(
    { type: storageSeed.type, modelFileId: storageSeed.modelFileId },
    { db, fields: storageSeed.fields, localId: storageSeed.localId },
  )
  await createVersion({ seedLocalId: storageSeed.localId, seedType: storageSeed.type }, { db })

  // Html and File store the property as e.g. htmlId; older rows may use the plain name
  const baseName = propertyName.endsWith('Id') ? propertyName.slice(0, -2) : propertyName
  const [existing] = await db
    .select({ localId: metadata.localId })
    .from(metadata)
    .where(
      and(
        eq(metadata.seedLocalId, seedLocalId),
        or(eq(metadata.propertyName, propertyName), eq(metadata.propertyName, baseName)),
      ),
    )
    .limit(1)
  if (existing?.localId) {
    const result = await updateItemPropertyValue(
      { ...value.update, localId: existing.localId, seedLocalId, propertyName } as never,
      { db },
    )
    return result ?? null
  }
  const row = await createMetadata(
    { ...value.create.values, seedLocalId, propertyName },
    value.create.propertyRecordSchema,
    { db },
  )
  return row.localId ? { localId: row.localId, uid: row.uid ?? null, schemaUid: row.schemaUid ?? '' } : null
}

/** Deletes the file a storage op wrote, once the op will never apply. */
async function discardStorageValue(op: OutboxOp): Promise<void> {
  const path = outboxOpValue<StorageValueOp>(op)?.ownedFilePath
  if (!path || !(await BaseFileManager.pathExists(path))) return
  const fs = await BaseFileManager.getFs()
  if (fs?.promises?.unlink) await fs.promises.unlink(path)
  else fs?.unlinkSync?.(path)
}

let registered = false

/** Registers the item appliers and starts draining. Safe to call more than once. */
export function startItemOutbox(): void {
  if (!registered) {
    registered = true
    registerOutboxApplier('set', {
      apply: async (op, tx): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<SetPropertyValueOp>(op)!
        const result = await updateItemPropertyValue(
          { ...value, seedLocalId: op.seedLocalId, propertyName: op.propertyName ?? undefined } as never,
          { db: tx },
        )
        return result ?? null
      },
    })
    registerOutboxApplier('storage', {
      apply: async (op, tx): Promise<SetPropertyValueResult> =>
        applyStorageValue(op.seedLocalId, op.propertyName!, outboxOpValue<StorageValueOp>(op)!, tx),
      discard: discardStorageValue,
    })
  }
  startOutbox()
}
