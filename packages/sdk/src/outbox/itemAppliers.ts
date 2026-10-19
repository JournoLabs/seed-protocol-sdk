/**
 * The appliers for item ops (ADR 0019). Every tab registers them at init: the leader applies ops
 * that other tabs appended.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { createSeed, type NewSeedFields } from '@/db/write/createSeed'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata } from '@/db/write/createMetadata'
import { getSeedPublisher } from '@/db/read/getSeedPublisher'
import { metadata, seeds, type MetadataType } from '@/seedSchema'
import type { PropertyType } from '@/types'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'
import { getItemStorageFilePath, withItemStorageFileLock } from '@/helpers/itemStorageFile'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { notifyFileSaved } from '@/helpers/tabEvents'
import { isItemOwned, OwnershipError } from '@/helpers/ownership'
import {
  OutboxOpFailedError,
  outboxOpValue,
  registerOutboxApplier,
  startOutbox,
  type OutboxOp,
} from './outbox'
import { findSetConflict, recordPropertyEdit } from './conflicts'

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
  // The item's publisher as it is now: a draft claimed while the op waited passes it on
  const parentPublisher = await getSeedPublisher(seedLocalId, db)
  await createSeed(
    { type: storageSeed.type, modelFileId: storageSeed.modelFileId },
    {
      db,
      fields: { ...storageSeed.fields, publisher: parentPublisher ?? storageSeed.fields.publisher },
      localId: storageSeed.localId,
    },
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

/**
 * A new item (Item.create): its seed, its first version and a row per property, applied in one
 * transaction, so a failure leaves nothing. The seed's local id is the op's `seedLocalId`.
 * ItemStorage initial values are staged files, moved into the item's files when applied.
 */
export type CreateItemOp = {
  modelName: string
  seed: { type: string; modelFileId?: string; fields: NewSeedFields }
  rows: Array<{
    propertyName: string
    propertyValue?: unknown
    /** EAS schema uid, resolved before the transaction. */
    schemaUid?: string
    propertyRecordSchema?: PropertyType
    /** An ItemStorage initial value: its staged file, moved to the item's file. */
    itemStorage?: { stagedPath: string; fileName: string; localStorageDir: string }
  }>
}

export type CreateItemResult = { seedLocalId: string; versionLocalId: string }

/** Writes a new item's rows on `db` (see CreateItemOp). */
export async function applyCreateItem(
  seedLocalId: string,
  value: CreateItemOp,
  db: ReturnType<typeof BaseDb.getAppDb>,
): Promise<CreateItemResult> {
  await createSeed(
    { type: value.seed.type, modelFileId: value.seed.modelFileId },
    { db, fields: value.seed.fields, localId: seedLocalId },
  )
  const versionLocalId = await createVersion({ seedLocalId, seedType: value.seed.type }, { db })
  for (const row of value.rows) {
    if (row.itemStorage) {
      const { stagedPath, fileName, localStorageDir } = row.itemStorage
      await moveStagedFile(stagedPath, BaseFileManager.getFilesPath(getItemStorageSubdir(localStorageDir), fileName))
    }
    await createMetadata(
      {
        seedLocalId,
        versionLocalId,
        propertyName: row.propertyName,
        propertyValue: row.itemStorage ? undefined : row.propertyValue,
        ...(row.itemStorage && {
          refResolvedValue: row.itemStorage.fileName,
          localStorageDir: row.itemStorage.localStorageDir,
          refValueType: 'file',
        }),
        ...(row.schemaUid && { schemaUid: row.schemaUid }),
        modelName: value.modelName,
      } as Parameters<typeof createMetadata>[0],
      row.propertyRecordSchema,
      { db, skipValidation: true, modelFileId: value.seed.modelFileId },
    )
  }
  return { seedLocalId, versionLocalId }
}

/**
 * Removes an item: `discard` hard-deletes a draft Item.create made and couldn't finish (the seed,
 * its versions and rows, the storage seeds its rows point at), `item` soft-deletes the seed
 * (Item.destroy), `property` deletes a property's rows (ItemProperty.destroy).
 */
export type DeleteOp =
  | { mode: 'discard' }
  | { mode: 'item' }
  | { mode: 'property'; propertyNames: string[] }
  /** The properties' local draft rows only, so their newest attested rows show again. */
  | { mode: 'drafts'; propertyNames: string[] }

/** Files a discarded draft's rows named, deleted once the op applied. */
export type DeleteResult = { filePaths: string[] }

/** Storage seeds a property row points at: Html, Image and File values are seeds of their own. */
const STORAGE_REF_TYPES = new Set(['html', 'image', 'file'])

export async function applyDelete(
  op: Pick<OutboxOp, 'opId' | 'seedLocalId'>,
  value: DeleteOp,
  db: ReturnType<typeof BaseDb.getAppDb>,
): Promise<DeleteResult> {
  if (value.mode === 'item') {
    await db.update(seeds).set({ _markedForDeletion: 1 }).where(eq(seeds.localId, op.seedLocalId))
    return { filePaths: [] }
  }
  if (value.mode === 'property') {
    await db
      .delete(metadata)
      .where(and(eq(metadata.seedLocalId, op.seedLocalId), inArray(metadata.propertyName, value.propertyNames)))
    return { filePaths: [] }
  }
  if (value.mode === 'drafts') {
    await db
      .delete(metadata)
      .where(
        and(
          eq(metadata.seedLocalId, op.seedLocalId),
          inArray(metadata.propertyName, value.propertyNames),
          isNull(metadata.uid),
        ),
      )
    return { filePaths: [] }
  }
  const rows = await db
    .select({
      propertyValue: metadata.propertyValue,
      refSeedType: metadata.refSeedType,
      refResolvedValue: metadata.refResolvedValue,
      localStorageDir: metadata.localStorageDir,
    })
    .from(metadata)
    .where(eq(metadata.seedLocalId, op.seedLocalId))
  const childSeedLocalIds: string[] = []
  const filePaths: string[] = []
  for (const row of rows) {
    if (row.refSeedType && STORAGE_REF_TYPES.has(row.refSeedType) && row.propertyValue) {
      childSeedLocalIds.push(row.propertyValue)
    }
    if (row.localStorageDir && row.refResolvedValue) {
      filePaths.push(BaseFileManager.getFilesPath(row.localStorageDir, row.refResolvedValue))
    }
  }
  const { hardDeleteLocalSeedsByLocalIds } = await import('@/db/write/removeLocalCopiesForAddresses')
  await hardDeleteLocalSeedsByLocalIds([op.seedLocalId, ...childSeedLocalIds], { db, keepOpId: op.opId })
  return { filePaths }
}

/** Deletes files after the op that removed their rows applied; best-effort. */
export async function deleteFiles(filePaths: string[]): Promise<void> {
  if (filePaths.length === 0) return
  const fs = await BaseFileManager.getFs()
  for (const path of filePaths) {
    try {
      if (!(await BaseFileManager.pathExists(path))) continue
      if (fs?.promises?.unlink) await fs.promises.unlink(path)
      else fs?.unlinkSync?.(path)
    } catch {
      // Best-effort: a file left behind has no row pointing at it
    }
  }
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

/**
 * The ownership rule, checked before an op applies (ADR 0019's async rules): the op may come from
 * another tab, or from before a reload, and the client may have lost the item's wallet since it
 * was appended. OwnershipError fails the op without a retry.
 */
async function requireOwned(op: OutboxOp): Promise<void> {
  if (!(await isItemOwned({ seedLocalId: op.seedLocalId }))) throw new OwnershipError()
}

/**
 * Rethrows a failed item op's error as its caller expects it: OwnershipError when the drainer
 * refused the op for ownership, else the OutboxOpFailedError as is.
 */
export function throwItemWriteError(error: unknown): never {
  if (error instanceof OutboxOpFailedError && error.errorName === 'OwnershipError') {
    throw new OwnershipError(error.message)
  }
  throw error
}

let registered = false

/** Registers the item appliers and starts draining. Safe to call more than once. */
export function startItemOutbox(): void {
  if (!registered) {
    registered = true
    registerOutboxApplier('set', {
      prepare: requireOwned,
      apply: async (op, tx): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<SetPropertyValueOp>(op)!
        // Before the write, which makes the edit the newest row
        const conflict = await findSetConflict(op, value, tx)
        const result = await updateItemPropertyValue(
          { ...value, seedLocalId: op.seedLocalId, propertyName: op.propertyName ?? undefined } as never,
          { db: tx },
        )
        await recordPropertyEdit(op, conflict, tx)
        return result ?? null
      },
    })
    registerOutboxApplier('storage', {
      prepare: requireOwned,
      // Storage values record no conflicts: their ops carry no base row (ADR 0019)
      apply: async (op, tx): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)!
        const result = isItemStorageOp(value)
          ? await applyItemStorageValue(op.seedLocalId, op.propertyName!, value, tx)
          : await applyStorageValue(op.seedLocalId, op.propertyName!, value, tx)
        await recordPropertyEdit(op, null, tx)
        return result
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
    registerOutboxApplier('create', {
      apply: async (op, tx): Promise<CreateItemResult> =>
        applyCreateItem(op.seedLocalId, outboxOpValue<CreateItemOp>(op)!, tx),
      // Staged ItemStorage values of a create that never applied
      discard: async (op) => {
        const paths = (outboxOpValue<CreateItemOp>(op)?.rows ?? []).flatMap((row) =>
          row.itemStorage ? [row.itemStorage.stagedPath] : [],
        )
        await deleteFiles(paths)
      },
    })
    registerOutboxApplier('delete', {
      // A discarded draft is the client's own create rolled back
      prepare: async (op) => {
        if (outboxOpValue<DeleteOp>(op)?.mode !== 'discard') await requireOwned(op)
      },
      apply: async (op, tx): Promise<DeleteResult> => applyDelete(op, outboxOpValue<DeleteOp>(op)!, tx),
    })
  }
  startOutbox()
}
