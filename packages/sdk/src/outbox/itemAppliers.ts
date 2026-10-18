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
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'
import { getItemStorageFilePath, withItemStorageFileLock } from '@/helpers/itemStorageFile'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { notifyFileSaved } from '@/helpers/tabEvents'
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

/**
 * An ItemStorage value: content kept in the item's own file (`<seedId><extension>`), written to a
 * staging file first. Applying it moves the staged file into place and points the property's
 * local draft row at it (a new draft when there is none), under the file's lock.
 */
export type ItemStorageValueOp = {
  itemStorage: {
    stagedPath: string
    seedUid?: string | null
    versionLocalId?: string | null
    versionUid?: string | null
    modelType?: string | null
    propertyRecordSchema: PropertyType
  }
}

/** The row an ItemStorage op wrote, and where its file is. */
export type ItemStorageValueResult = NonNullable<SetPropertyValueResult> & {
  fileName: string
  localStorageDir: string
}

/** A local edit: no attestation uid of its own and not derived from one. */
const isLocalDraft = (row: Pick<MetadataType, 'uid' | 'derivedFromUid'>): boolean =>
  !row.uid && row.derivedFromUid == null

/** The ItemStorage file a new draft of this item writes to (and so the lock to hold). */
const itemStorageTargetPath = (seedLocalId: string, value: ItemStorageValueOp['itemStorage']) =>
  getItemStorageFilePath({
    seedId: value.seedUid || seedLocalId,
    localStorageDir: value.propertyRecordSchema.localStorageDir,
    filenameSuffix: value.propertyRecordSchema.filenameSuffix,
  })

/**
 * Moves a staged file into place. A retry after the move but before the commit finds the staged
 * file gone and the target there: already moved.
 */
async function moveStagedFile(from: string, to: string): Promise<void> {
  if (!(await BaseFileManager.pathExists(from))) {
    if (await BaseFileManager.pathExists(to)) return
    throw new Error(`Staged file ${from} is missing`)
  }
  await BaseFileManager.createDirIfNotExists(to.slice(0, to.lastIndexOf('/')))
  const fs = await BaseFileManager.getFs()
  await fs.promises.rename(from, to)
  notifyFileSaved(to)
}

/**
 * Writes an ItemStorage value on `db`: the edit goes into the property's current local draft, or a
 * new one when there is none or a published row is newer (readers show the newest row). A synced
 * or derived row is published content and is never written to.
 */
export async function applyItemStorageValue(
  seedLocalId: string,
  propertyName: string,
  op: ItemStorageValueOp,
  db: ReturnType<typeof BaseDb.getAppDb>,
): Promise<ItemStorageValueResult> {
  const value = op.itemStorage
  const schema = value.propertyRecordSchema
  const where = [eq(metadata.propertyName, propertyName), eq(metadata.seedLocalId, seedLocalId)]
  if (value.versionLocalId) where.push(eq(metadata.versionLocalId, value.versionLocalId))
  const rows: MetadataType[] = await db.select().from(metadata).where(and(...where))
  const latest = [...rows].sort(compareMetadataRowsLatestFirst)[0]
  let draft = latest && isLocalDraft(latest) ? latest : undefined
  if (!draft) {
    draft = await createMetadata(
      {
        propertyName,
        propertyValue: getItemStorageLocalFileName(value.seedUid || seedLocalId, schema.filenameSuffix),
        modelType: value.modelType ?? undefined,
        seedLocalId,
        seedUid: value.seedUid ?? undefined,
        versionLocalId: value.versionLocalId ?? undefined,
        versionUid: value.versionUid ?? undefined,
        localStorageDir: schema.localStorageDir,
        refValueType: 'file',
      },
      schema,
      { db },
    )
  }
  // No storage.path: the `files` directory, as resolveItemStorageChildFile and download assume.
  const localStorageDir = schema.localStorageDir || draft.localStorageDir || '/files'
  const fileName =
    draft.refResolvedValue ||
    getItemStorageLocalFileName(draft.seedUid || draft.seedLocalId || seedLocalId, schema.filenameSuffix)
  await moveStagedFile(value.stagedPath, BaseFileManager.getFilesPath(getItemStorageSubdir(localStorageDir), fileName))

  // A legacy row (made before Item.create saved ItemStorage values) holds the old content itself in
  // propertyValue. The file is the content now: drop it, or a fresh load shows the old text until
  // the file is read. A row whose propertyValue is the file name keeps it.
  const clearsVerbatimValue =
    !draft.refResolvedValue && draft.propertyValue != null && draft.propertyValue !== '' && draft.propertyValue !== fileName
  const now = Date.now()
  await db
    .update(metadata)
    .set({
      refResolvedValue: fileName,
      localStorageDir,
      // The draft is as new as its content (see updateItemPropertyValue).
      createdAt: now,
      updatedAt: now,
      // Same shape as a row the migration or publish converted (convertVerbatimItemStorageRow).
      ...(clearsVerbatimValue && { propertyValue: null, refValueType: 'file' }),
    })
    .where(eq(metadata.localId, draft.localId!))
  return { localId: draft.localId!, uid: draft.uid ?? null, schemaUid: draft.schemaUid ?? '', fileName, localStorageDir }
}

const isItemStorageOp = (value: unknown): value is ItemStorageValueOp =>
  typeof value === 'object' && value !== null && 'itemStorage' in value

/** Deletes the file a storage op wrote, once the op will never apply. */
async function discardStorageValue(op: OutboxOp): Promise<void> {
  const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)
  const path = value && (isItemStorageOp(value) ? value.itemStorage.stagedPath : value.ownedFilePath)
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
      apply: async (op, tx): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)!
        return isItemStorageOp(value)
          ? applyItemStorageValue(op.seedLocalId, op.propertyName!, value, tx)
          : applyStorageValue(op.seedLocalId, op.propertyName!, value, tx)
      },
      // ItemStorage: the file's lock before the transaction, the order its other writers use
      around: (op, run) => {
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)
        return value && isItemStorageOp(value)
          ? withItemStorageFileLock(itemStorageTargetPath(op.seedLocalId, value.itemStorage), run)
          : run()
      },
      discard: discardStorageValue,
    })
  }
  startOutbox()
}
