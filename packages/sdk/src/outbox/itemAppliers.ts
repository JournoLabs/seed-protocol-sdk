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
import { matchMetadataProperty, metadataRowsOfProperty } from '@/db/read/metadataProperty'
import { getItemStorageFilePath, tryWithItemStorageFileLock } from '@/helpers/itemStorageFile'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { notifyFileSaved } from '@/helpers/tabEvents'
import { isItemOwned, OwnershipError } from '@/helpers/ownership'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { normalizeDataType } from '@/helpers/property'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import {
  OutboxOpDeferredError,
  OutboxOpFailedError,
  outboxOpValue,
  registerOutboxApplier,
  startOutbox,
  type OutboxOp,
} from './outbox'
import { findSetConflict, recordPropertyEdit } from './conflicts'
import { storageValueRowOf } from './storageValueRow'
import { getLatestVersionRow } from '@/db/read/getLatestVersionRow'
import { afterStorageValueApplied, prepareStorageValue, type PreparedStorageValue } from '@/storageValue/save'
import { requireStagedFile, StagedValueMissingError } from '@/storageValue/stage'

/**
 * A plain value (Text, Number, Boolean, Date, List, a Relation's seed id) for one item property,
 * as `updateItemPropertyValue` takes it: the value already in its stored string form. A missing
 * schema uid is looked up before the transaction (applying mustn't wait on EAS).
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
  /** The property's definition, when `schemaUid` is missing: the lookup reads it. */
  propertyRecordSchema?: PropertyType
  /**
   * A clear (ADR 0021): `newValue` is null and the row's file reference is dropped. `retract` marks
   * a clear that publish revokes.
   */
  clear?: { retract: boolean }
}

/** The row a `set` op wrote (updateItemPropertyValue's result). */
export type SetPropertyValueResult = {
  localId: string
  uid: string | null
  schemaUid: string
} | null

/**
 * An Html, File or Image value: a new storage seed and the property row that points at it. The
 * assigned value is in `stage`: preparing the op writes its file, named after the seed so nothing
 * else uses it (prepareStorageValue). Applying it creates the storage seed and its version and
 * writes the row, all in the op's transaction. Ops appended by an earlier SDK carry no `stage`:
 * their file was written first and named in `ownedFilePath`.
 */
export type StorageValueOp = {
  storageSeed: {
    /** Chosen when the value was assigned, so the file can be named after it. */
    localId: string
    type: 'html' | 'file' | 'image'
    modelFileId: string
    /** Resolved when the op is prepared; older ops carry them. */
    fields?: NewSeedFields
  }
  /**
   * The assigned value: `source` for a string (a URL, a file name, Html or File text), else the
   * bytes in the op's staged file (`value_ref`) with the type and name the Blob had.
   */
  stage?: { source?: string; mimeType?: string; sourceName?: string }
  /** Older ops: the file written for this value, deleted if the op never applies. Absent for a reference to a file that was already there. */
  ownedFilePath?: string
  /**
   * The row's fields besides the ones the storage seed gives (value, `refSeedType`, EAS type), for
   * the property's first row and for a newer one alike. Ops appended by an older SDK carry `create`
   * and `update` instead (see storageValueRowOf).
   */
  row?: StorageValueRow
  propertyRecordSchema?: PropertyType
  /** Older ops: the first row's fields. */
  create?: { values: Partial<MetadataType> & { modelName?: string }; propertyRecordSchema?: PropertyType }
  /** Older ops: a newer row's fields. */
  update?: Record<string, unknown>
}

export type StorageValueRow = {
  /** The file's name; empty until the op is prepared when the assigned value didn't tell it. */
  refResolvedValue: string
  localStorageDir: string
  schemaUid?: string | null
  /** The storage model's EAS schema uid. */
  refModelUid?: string | null
  modelName?: string | null
  seedUid?: string | null
  versionLocalId?: string | null
  versionUid?: string | null
}

const STORAGE_DATA_TYPE = { image: 'Image', file: 'File', html: 'Html' } as const

/** The row a storage op wrote, and its file. */
export type StorageValueResult = (NonNullable<SetPropertyValueResult> & { fileName: string; localStorageDir: string }) | null

/**
 * Writes a storage value's rows on `db`. The property's row is looked up here, on `db`, rather than
 * taken from the edit: two quick edits of a property that had no row would otherwise both create one.
 * `prepared` is what prepareStorageValue found (the file's name, the seed's fields); older ops
 * carry those themselves.
 */
export async function applyStorageValue(
  seedLocalId: string,
  propertyName: string,
  value: StorageValueOp,
  db: ReturnType<typeof BaseDb.getAppDb>,
  prepared?: PreparedStorageValue,
): Promise<StorageValueResult> {
  const { storageSeed } = value
  const seedFields = prepared?.fields ?? storageSeed.fields
  if (!seedFields) throw new Error(`Storage value ${storageSeed.localId} was applied without being prepared`)
  // The item's publisher as it is now: a draft claimed while the op waited passes it on
  const parentPublisher = await getSeedPublisher(seedLocalId, db)
  await createSeed(
    { type: storageSeed.type, modelFileId: storageSeed.modelFileId },
    {
      db,
      fields: { ...seedFields, publisher: parentPublisher ?? seedFields.publisher },
      localId: storageSeed.localId,
    },
  )
  await createVersion({ seedLocalId: storageSeed.localId, seedType: storageSeed.type }, { db })

  // The property's current row (decision D4); the op's own value isn't stored yet, so no overlay
  const stored = storageValueRowOf(value)
  const row = prepared
    ? { ...stored, refResolvedValue: prepared.fileName, schemaUid: prepared.schemaUid, refModelUid: prepared.refModelUid }
    : stored
  const { currentPropertyRow } = await import('@/db/read/currentPropertyRow')
  const existing = await currentPropertyRow(
    { seedLocalId },
    {
      propertyName,
      modelName: row.modelName,
      definitionId: row.propertyRecordSchema?.id as string | number | undefined,
    },
    { overlay: false, db: db! },
  )
  const fields = {
    schemaUid: row.schemaUid,
    refSeedType: storageSeed.type,
    refModelUid: row.refModelUid,
    refResolvedValue: row.refResolvedValue,
    localStorageDir: row.localStorageDir,
    easDataType: 'bytes32',
  }
  const file = { fileName: row.refResolvedValue, localStorageDir: row.localStorageDir }
  if (existing?.localId) {
    const result = await updateItemPropertyValue(
      {
        ...fields,
        newValue: storageSeed.localId,
        versionLocalId: row.versionLocalId,
        modelName: row.modelName,
        dataType: STORAGE_DATA_TYPE[storageSeed.type],
        localId: existing.localId,
        seedLocalId,
        propertyName,
      } as never,
      { db },
    )
    return result ? { ...result, ...file } : null
  }
  const created = await createMetadata(
    {
      ...fields,
      propertyValue: storageSeed.localId,
      seedUid: row.seedUid,
      versionLocalId: row.versionLocalId,
      versionUid: row.versionUid,
      modelName: row.modelName ?? undefined,
      seedLocalId,
      propertyName,
    },
    row.propertyRecordSchema,
    { db },
  )
  return created.localId
    ? { localId: created.localId, uid: created.uid ?? null, schemaUid: created.schemaUid ?? '', ...file }
    : null
}

/**
 * An ItemStorage value: content kept in the item's own file (`<seedId><extension>`), written to a
 * staging file first. Applying it moves the staged file into place and points the property's
 * local draft row at it (a new draft when there is none), under the file's lock.
 */
export type ItemStorageValueOp = {
  itemStorage: {
    /** Also the op's `value_ref`. */
    stagedPath: string
    /** A string value as assigned, so the op can be staged again if its tab closed before writing it. */
    source?: string
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
  /** The item's head version when the op was prepared; the op's own when not given. */
  head?: { versionLocalId?: string | null; versionUid?: string | null },
): Promise<ItemStorageValueResult> {
  const value = head?.versionLocalId
    ? { ...op.itemStorage, versionLocalId: head.versionLocalId, versionUid: head.versionUid }
    : op.itemStorage
  const schema = value.propertyRecordSchema
  const property = await matchMetadataProperty(
    {
      propertyName,
      seedLocalId,
      modelName: value.modelType,
      definitionId: schema?.id as string | number | undefined,
    },
    db,
  )
  const where = [metadataRowsOfProperty(property), eq(metadata.seedLocalId, seedLocalId)]
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
  if (value.mode === 'property' || value.mode === 'drafts') {
    // The properties' rows by property_id (decision D4), and rows with none by the names given
    const ids = new Set<number>()
    const names = new Set<string>(value.propertyNames)
    for (const propertyName of value.propertyNames) {
      const match = await matchMetadataProperty({ propertyName, seedLocalId: op.seedLocalId }, db)
      if (match.propertyId == null) continue
      ids.add(match.propertyId)
      for (const name of match.names) names.add(name)
    }
    const byName = inArray(metadata.propertyName, [...names])
    const ofProperties = ids.size
      ? or(inArray(metadata.propertyId, [...ids]), and(isNull(metadata.propertyId), byName))
      : byName
    await db
      .delete(metadata)
      .where(
        and(
          eq(metadata.seedLocalId, op.seedLocalId),
          ofProperties,
          ...(value.mode === 'drafts' ? [isNull(metadata.uid)] : []),
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

/** Deletes the files a storage op wrote (staged, and its file when it was prepared), once the op will never apply. */
async function discardStorageValue(op: OutboxOp, prepared: unknown): Promise<void> {
  const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)
  const owned = value && !isItemStorageOp(value)
    ? (prepared as PreparedStorageValue | undefined)?.ownedFilePath ?? value.ownedFilePath
    : undefined
  const staged = op.valueRef ?? (value && isItemStorageOp(value) ? value.itemStorage.stagedPath : undefined)
  await deleteFiles([owned, staged].filter((path): path is string => !!path))
}

/**
 * The ownership rule, checked before an op applies (ADR 0019's async rules): the op may come from
 * another tab, or from before a reload, and the client may have lost the item's wallet since it
 * was appended. OwnershipError fails the op without a retry.
 */
async function requireOwned(op: OutboxOp): Promise<void> {
  if (!(await isItemOwned({ seedLocalId: op.seedLocalId }))) throw new OwnershipError()
}

/** A Relation value names a local seed that doesn't exist. */
export class RelationTargetError extends Error {
  constructor(readonly targets: string[]) {
    super(`Relation target not found: ${targets.join(', ')}`)
    this.name = 'RelationTargetError'
  }

  /** Rebuilds the error from its message, as an op row stores it; undefined for any other message. */
  static fromMessage(message: string): RelationTargetError | undefined {
    const match = /^Relation target not found: (.+)$/.exec(message)
    return match ? new RelationTargetError(match[1]!.split(', ')) : undefined
  }
}

/** The seed ids a Relation or List-of-Relation value names; none for other values. */
function relationTargets(value: { dataType?: string; refValueType?: string; newValue: unknown }): string[] {
  const dataType = normalizeDataType(value.dataType)
  const refValueType = normalizeDataType(value.refValueType)
  const { newValue } = value
  if (!newValue) return []
  if (dataType === 'Relation' && refValueType !== 'Image') return typeof newValue === 'string' ? [newValue] : []
  if (dataType === 'List' && refValueType === 'Relation') {
    if (Array.isArray(newValue)) return newValue.filter((id): id is string => typeof id === 'string')
    return typeof newValue === 'string' ? parseListPropertyValueFromStorage(newValue) : []
  }
  return []
}

/** The seed ids a create's initial Relation and List-of-Relation values name. */
function createRelationTargets(value: CreateItemOp | undefined): string[] {
  return (value?.rows ?? []).flatMap((row) =>
    relationTargets({
      dataType: row.propertyRecordSchema?.dataType,
      refValueType: row.propertyRecordSchema?.refValueType,
      newValue: row.propertyValue,
    }),
  )
}

/**
 * The relation-target rule, checked before a `set` or `create` applies: each seed a Relation value
 * names by local id must exist. An attestation uid may name a seed with no local copy, so uids pass. A
 * target whose create op is still pending defers the op (OutboxOpDeferredError) until it applies;
 * any other missing target fails it with RelationTargetError.
 */
async function requireRelationTargets(op: OutboxOp): Promise<void> {
  const targets =
    op.kind === 'create'
      ? createRelationTargets(outboxOpValue<CreateItemOp>(op))
      : relationTargets(outboxOpValue<SetPropertyValueOp>(op) ?? { newValue: null })
  // A create may relate the item to itself
  const localIds = [...new Set(targets)].filter((id) => !isValidEasAttestationUid(id) && id !== op.seedLocalId)
  if (localIds.length === 0) return
  const db = BaseDb.getAppDb()
  const found = await db.select({ localId: seeds.localId }).from(seeds).where(inArray(seeds.localId, localIds))
  const missing = localIds.filter((id) => !found.some((row: { localId: string | null }) => row.localId === id))
  if (missing.length === 0) return
  const creating = await db
    .select({ seedLocalId: pendingWrites.seedLocalId })
    .from(pendingWrites)
    .where(
      and(
        inArray(pendingWrites.seedLocalId, missing),
        eq(pendingWrites.kind, 'create'),
        eq(pendingWrites.status, 'pending'),
      ),
    )
  if (creating.length > 0) throw new OutboxOpDeferredError(`Relation target ${creating[0].seedLocalId} is being created`)
  throw new RelationTargetError(missing)
}

/**
 * Rethrows a failed item op's error as its caller expects it: OwnershipError when the drainer
 * refused the op for ownership, else the OutboxOpFailedError. For a RelationTargetError or a
 * StagedValueMissingError its `cause` is that error, rebuilt from the op row (decision D31): the op
 * may have failed in another tab or before a reload, so the original instance isn't here.
 */
export function throwItemWriteError(error: unknown): never {
  if (!(error instanceof OutboxOpFailedError)) throw error
  if (error.errorName === 'OwnershipError') throw new OwnershipError(error.message)
  const cause =
    error.errorName === 'RelationTargetError'
      ? RelationTargetError.fromMessage(error.message)
      : error.errorName === 'StagedValueMissingError'
        ? StagedValueMissingError.fromMessage(error.message)
        : undefined
  if (cause && error.cause === undefined) error.cause = cause
  throw error
}

/** The item's head version, read when an ItemStorage op is prepared (a publish may have added one since it was appended). */
type ItemStorageHead = { versionLocalId?: string | null; versionUid?: string | null }

/** Stages an ItemStorage op's file again from its source if the appending tab didn't write it; reads the head version. */
async function prepareItemStorageValue(op: OutboxOp, value: ItemStorageValueOp): Promise<ItemStorageHead> {
  await requireStagedFile(op.valueRef ?? value.itemStorage.stagedPath, value.itemStorage.source)
  const head = await getLatestVersionRow(op.seedLocalId)
  return { versionLocalId: head?.localId ?? undefined, versionUid: head?.uid ?? undefined }
}

let registered = false

/** Registers the item appliers and starts draining. Safe to call more than once. */
export function startItemOutbox(): void {
  if (!registered) {
    registered = true
    registerOutboxApplier<{ schemaUid?: string }>('set', {
      prepare: async (op) => {
        await requireOwned(op)
        await requireRelationTargets(op)
        const value = outboxOpValue<SetPropertyValueOp>(op)
        if (value?.schemaUid || !value?.propertyRecordSchema || !op.propertyName) return {}
        // Cached, shared with item creation, so a save doesn't wait on the EAS indexer each time.
        // Not required for the row; publish resolves the schema again.
        const { lookupPropertySchemaUid } = await import('@/helpers/propertySchemaUid')
        return {
          schemaUid: await lookupPropertySchemaUid(
            op.propertyName,
            value.propertyRecordSchema,
          ),
        }
      },
      apply: async (op, tx, prepared): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<SetPropertyValueOp>(op)!
        // Before the write, which makes the edit the newest row
        const conflict = await findSetConflict(op, value, tx)
        const { clear, propertyRecordSchema: _definition, ...props } = value
        const result = await updateItemPropertyValue(
          {
            ...props,
            schemaUid: props.schemaUid || prepared?.schemaUid,
            ...(clear && {
              newValue: null,
              refSeedType: null,
              refResolvedValue: null,
              refResolvedDisplayValue: null,
              localStorageDir: null,
              retract: clear.retract,
            }),
            seedLocalId: op.seedLocalId,
            propertyName: op.propertyName ?? undefined,
          } as never,
          { db: tx },
        )
        await recordPropertyEdit(op, conflict, tx)
        return result ?? null
      },
    })
    registerOutboxApplier<PreparedStorageValue | ItemStorageHead | undefined>('storage', {
      prepare: async (op) => {
        await requireOwned(op)
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)!
        if (isItemStorageOp(value)) return prepareItemStorageValue(op, value)
        return value.stage ? prepareStorageValue(op, value) : undefined
      },
      // Storage values record no conflicts: their ops carry no base row (ADR 0019)
      apply: async (op, tx, prepared): Promise<SetPropertyValueResult> => {
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)!
        const result = isItemStorageOp(value)
          ? await applyItemStorageValue(op.seedLocalId, op.propertyName!, value, tx, prepared as ItemStorageHead | undefined)
          : await applyStorageValue(op.seedLocalId, op.propertyName!, value, tx, prepared as PreparedStorageValue | undefined)
        await recordPropertyEdit(op, null, tx)
        return result
      },
      afterApply: async (op, prepared) => {
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)
        if (value && !isItemStorageOp(value)) {
          await afterStorageValueApplied(op, value, prepared as PreparedStorageValue | undefined)
        }
      },
      // ItemStorage: the file's lock before the transaction, the order its other writers use. Taken
      // only when free: another writer holding it would otherwise hold up every other op.
      around: async (op, run) => {
        const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)
        if (!value || !isItemStorageOp(value)) return run()
        const path = itemStorageTargetPath(op.seedLocalId, value.itemStorage)
        const outcome = await tryWithItemStorageFileLock(path, run)
        if (!outcome.acquired) throw new OutboxOpDeferredError(`ItemStorage file ${path} is locked`)
        return outcome.value
      },
      discard: discardStorageValue,
    })
    registerOutboxApplier('create', {
      prepare: (op) => requireRelationTargets(op),
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
