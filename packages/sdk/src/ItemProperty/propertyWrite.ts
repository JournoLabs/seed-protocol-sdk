/**
 * What an assignment writes (ADR 0019, decision D2): the setter checks the value, shows it and
 * appends its outbox op before it returns, so the op is the value's only record and the overlay
 * (a property's newest pending op over its stored row) is always what it shows. The async rules
 * (ownership, relation targets) and a storage value's slow steps (fetching it, writing its file)
 * run when the op is prepared (outbox/itemAppliers.ts, storageValue/save.ts).
 */
import { easName } from '@seedprotocol/eas'
import { appendOutboxOp, getOutboxOps, type AppendOutboxOpInput } from '@/outbox/outbox'
import type { ItemStorageValueOp, SetPropertyValueOp, StorageValueOp } from '@/outbox/itemAppliers'
import type { PropertyMachineContext } from '@/types/property'
import type { ValidationError } from '@/Schema/validation'
import type { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { INTERNAL_STORAGE_MODEL_FILE_IDS } from '@/helpers/constants'
import { generateId } from '@/helpers/generateId'
import { toMetadataPropertyName } from '@/helpers/metadataPropertyNames'
import { normalizeMimeType } from '@/helpers/mimeTypes'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import { createSessionObjectUrl } from '@/helpers/sessionObjectUrls'
import { STORAGE_SUBDIR, decodeDataUrl, storageFileName, type StorageKind } from '@/storageValue/content'
import { deleteStagedFile, newStagedPath, writeStagedFile } from '@/storageValue/stage'

// The setter checks values synchronously, so the validation module is loaded ahead of the first
// assignment: ItemProperty's constructor starts it. Imported dynamically to break the cycle
// Schema/index -> ... -> ItemProperty -> Schema/index, and not at this module's load, which can run
// while that cycle is still being evaluated.
let validationService: SchemaValidationService | undefined
let validationLoading: Promise<void> | undefined

/** Loads the validation module; resolves once the setter can check values (see planPropertyWrite). */
export function whenValidationLoaded(): Promise<void> {
  if (validationService) return Promise.resolve()
  // async/await, not import().then: rollup's dynamic-import rewrite (rollup.config.mjs) only
  // neutralizes the minified chunk-export read (`.then(n => n._)`) in this form
  validationLoading ??= (async () => {
    try {
      const { SchemaValidationService } = await import('@/Schema/service/validation/SchemaValidationService')
      validationService = new SchemaValidationService()
    } finally {
      validationLoading = undefined
    }
  })()
  return validationLoading
}

export const isValidationLoaded = (): boolean => validationService !== undefined

/** What a clear shows at once: no value and no file. */
export const CLEARED_CONTEXT = {
  propertyValue: null,
  renderValue: null,
  refResolvedValue: undefined,
  refResolvedDisplayValue: undefined,
  localStorageDir: undefined,
  storageTransactionId: undefined,
} as const

/** Which write a value of this definition takes; Image, File and Html before ItemStorage, as saves always routed. */
export type PropertyWriteKind = StorageKind | 'itemStorage' | 'set'

export function propertyWriteKind(schema: NonNullable<PropertyMachineContext['propertyRecordSchema']>): PropertyWriteKind {
  const dataType = normalizeDataType(schema.dataType)
  const refValueType = normalizeDataType(schema.refValueType)
  if (refValueType === ModelPropertyDataTypes.Image || dataType === ModelPropertyDataTypes.Image) return 'image'
  if (dataType === ModelPropertyDataTypes.File) return 'file'
  if (dataType === ModelPropertyDataTypes.Html) return 'html'
  if (schema.storageType === 'ItemStorage') return 'itemStorage'
  return 'set'
}

/** An assignment's op, ready to append, and what the property shows meanwhile. */
export type PlannedWrite = {
  writeKind: PropertyWriteKind
  op: Omit<AppendOutboxOpInput, 'seedLocalId'>
  /** Context fields to show at once. */
  display: Partial<PropertyMachineContext>
  /** Content the appending tab writes to the op's staged file (`op.valueRef`) before appending. */
  staged?: { path: string; content: string | Blob | ArrayBuffer }
  /** The value as the setter got it, normalized (a List's array): what shows once the op applies. */
  value: unknown
}

export type PropertyWritePlan = PlannedWrite | { writeKind: 'invalid'; errors: ValidationError[] }

const DATA_TYPE: Record<StorageKind, 'Image' | 'File' | 'Html'> = { image: 'Image', file: 'File', html: 'Html' }

const isBlob = (value: unknown): value is Blob => typeof Blob !== 'undefined' && value instanceof Blob

/** A plain value or a clear: one `set` op. */
function setOp(context: PropertyMachineContext, value: Pick<SetPropertyValueOp, 'newValue' | 'clear'>): PlannedWrite['op'] {
  const schema = context.propertyRecordSchema!
  const op: SetPropertyValueOp = {
    ...value,
    localId: context.localId,
    versionLocalId: context.versionLocalId,
    versionUid: context.versionUid,
    modelName: context.modelName,
    schemaUid: context.schemaUid,
    dataType: schema.dataType,
    refValueType: schema.refValueType,
    ...(!context.schemaUid && { propertyRecordSchema: schema }),
  }
  return { propertyName: context.propertyName, kind: 'set', value: op, baseRowId: context.localId ?? null }
}

/**
 * An Image, File or Html value: a new storage seed, named now so its file can be named after it.
 * A string goes in the op as assigned; a Blob's bytes (and a `data:` URL's, decoded) go to a
 * staged file the appending tab writes.
 */
function storagePlan(kind: StorageKind, context: PropertyMachineContext, value: unknown): PlannedWrite {
  const storageSeedLocalId = generateId()
  const subdir = STORAGE_SUBDIR[kind]
  const dataUrl = typeof value === 'string' ? decodeDataUrl(value) : undefined
  let stage: NonNullable<StorageValueOp['stage']>
  let staged: PlannedWrite['staged']
  let shown: unknown = value
  if (isBlob(value)) {
    const sourceName = typeof File !== 'undefined' && value instanceof File ? value.name : undefined
    stage = { mimeType: normalizeMimeType(value.type), sourceName }
    staged = { path: newStagedPath(generateId()), content: value }
    shown = createSessionObjectUrl(value)
  } else if (dataUrl) {
    stage = { mimeType: dataUrl.mimeType }
    staged = { path: newStagedPath(generateId()), content: dataUrl.bytes }
  } else {
    stage = { source: typeof value === 'string' ? value : String(value) }
  }
  // Known now for Html and for bytes whose type or name is known; otherwise once the op is prepared
  const fileName =
    kind === 'html'
      ? `${storageSeedLocalId}.html`
      : staged && (stage.mimeType || stage.sourceName)
        ? storageFileName(kind, storageSeedLocalId, { kind: 'bytes', data: new ArrayBuffer(0), ...stage })
        : ''
  const storageValue: StorageValueOp = {
    storageSeed: { localId: storageSeedLocalId, type: kind, modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS[kind] },
    stage,
    row: {
      seedUid: context.seedUid,
      versionLocalId: context.versionLocalId,
      versionUid: context.versionUid,
      modelName: context.modelName,
      schemaUid: context.schemaUid,
      refResolvedValue: fileName,
      localStorageDir: `/${subdir}`,
    },
    propertyRecordSchema: context.propertyRecordSchema,
  }
  return {
    writeKind: kind,
    op: {
      propertyName: toMetadataPropertyName(context.propertyName!, DATA_TYPE[kind]),
      kind: 'storage',
      value: storageValue,
      valueRef: staged?.path ?? null,
    },
    // The seed id, as the overlay reads it. The file's name comes with the applied row: until then
    // the display pass has no file to look for and keeps what shows.
    display: {
      propertyValue: storageSeedLocalId,
      refSeedType: kind,
      renderValue: shown,
      refResolvedDisplayValue: kind === 'html' || typeof shown !== 'string' ? undefined : shown,
      refResolvedValue: undefined,
      localStorageDir: `/${subdir}`,
      storageTransactionId: undefined,
      easDataType: 'bytes32',
    },
    staged,
    value,
  }
}

/** An ItemStorage value: staged by the appending tab, moved into the item's file when the op applies. */
function itemStoragePlan(context: PropertyMachineContext, value: unknown): PlannedWrite {
  const stagedPath = newStagedPath(generateId())
  const itemStorage: ItemStorageValueOp['itemStorage'] = {
    stagedPath,
    ...(typeof value === 'string' && { source: value }),
    seedUid: context.seedUid,
    versionLocalId: context.versionLocalId,
    versionUid: context.versionUid,
    modelType: context.modelName ? easName(context.modelName) : undefined,
    propertyRecordSchema: context.propertyRecordSchema!,
  }
  return {
    writeKind: 'itemStorage',
    op: { propertyName: context.propertyName, kind: 'storage', value: { itemStorage }, valueRef: stagedPath },
    display: { propertyValue: value as PropertyMachineContext['propertyValue'], renderValue: value },
    staged: { path: stagedPath, content: value as string | Blob | ArrayBuffer },
    value,
  }
}

/**
 * Checks an assigned value against its property's definition and plans its op. Synchronous: call
 * it only when the context has a definition and isValidationLoaded(), and the file system is set up
 * for storage values (newStagedPath throws otherwise). A value that breaks a rule gets no op; it
 * stays shown with its errors (ADR 0019 "Assignment").
 */
export function planPropertyWrite(
  context: PropertyMachineContext,
  value: unknown,
  clear?: { retract: boolean },
): PropertyWritePlan {
  const schema = context.propertyRecordSchema!
  if (clear) {
    return {
      writeKind: 'set',
      op: setOp(context, { newValue: null, clear }),
      display: { ...CLEARED_CONTEXT, retract: clear.retract || undefined } as Partial<PropertyMachineContext>,
      value: null,
    }
  }
  const dataType = normalizeDataType(schema.dataType)
  let newValue = value
  if (dataType === ModelPropertyDataTypes.List && typeof newValue === 'string' && newValue.trim() !== '') {
    newValue = [newValue.trim()]
  }

  const result = validationService!.validatePropertyValue(
    newValue,
    schema.dataType as ModelPropertyDataTypes,
    schema.validation,
    schema.refValueType as string | undefined,
  )
  if (!result.isValid) return { writeKind: 'invalid', errors: result.errors }

  const writeKind = propertyWriteKind(schema)
  if (writeKind === 'image' || writeKind === 'file' || writeKind === 'html') {
    // An empty value has nothing to store (setValue sends one as a clear)
    if (newValue == null || (typeof newValue === 'string' && newValue.trim() === '')) {
      return {
        writeKind: 'invalid',
        errors: [
          {
            field: 'value',
            message: `${context.propertyName} can't be saved empty: use clear() to remove a ${schema.dataType} value`,
            code: 'empty_storage_value',
            severity: 'error' as const,
          },
        ],
      }
    }
    return storagePlan(writeKind, context, newValue)
  }
  if (writeKind === 'itemStorage') return itemStoragePlan(context, newValue)

  // List (including lists of relations): JSON in the row, the array in context
  const stored =
    dataType === ModelPropertyDataTypes.List && Array.isArray(newValue)
      ? JSON.stringify(newValue)
      : newValue == null
        ? null
        : typeof newValue === 'string'
          ? newValue
          : String(newValue)
  return {
    writeKind: 'set',
    op: setOp(context, { newValue: stored }),
    display: { propertyValue: newValue as PropertyMachineContext['propertyValue'], renderValue: newValue },
    value: Array.isArray(newValue) ? newValue : stored,
  }
}

/**
 * Appends a planned write's op, after starting the write of its staged file. The staging lock is
 * requested first, so a drainer never finds the op without it (requireStagedFile). A failed staging
 * write fails the op when it is prepared. A file that lands after a newer value superseded its op
 * is deleted here: the op's discard step ran before it existed. Returns the op id once appended.
 */
export function appendPlannedWrite(seedLocalId: string, plan: PlannedWrite): Promise<string> {
  const staging = plan.staged && writeStagedFile(plan.staged.path, plan.staged.content)
  const appended = appendOutboxOp({ ...plan.op, seedLocalId })
  if (staging) {
    Promise.all([staging, appended])
      .then(async ([, opId]) => {
        const [op] = await getOutboxOps([opId])
        if (op?.status === 'superseded' || op?.status === 'failed') await deleteStagedFile(plan.staged!.path)
      })
      .catch(() => {})
  }
  return appended
}
