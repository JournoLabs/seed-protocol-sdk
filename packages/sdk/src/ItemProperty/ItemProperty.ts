import { ActorRefFrom, createActor, SnapshotFrom, Subscription, waitFor } from 'xstate'
import type { DeleteOp } from '@/outbox'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { Static } from '@sinclair/typebox'
import { IItemProperty } from '@/interfaces/IItemProperty'
import { CreatePropertyInstanceProps, PropertyMachineContext, PropertyType as SchemaPropertyType } from '@/types'
import type { CreateWaitOptions } from '@/types'
// Dynamic import to break circular dependency: Model -> Item -> ItemProperty -> Model
// import { Model } from '@/Model/Model'
import { propertyMachine } from './service/propertyMachine'
import {
  INTERNAL_PROPERTY_NAMES,
  PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP,
} from '@/helpers/constants'
import debug from 'debug'
import pluralize from 'pluralize'
import { currentPropertyRow } from '@/db/read/currentPropertyRow'
import { getPropertyConflict } from '@/outbox/conflicts'
import { getItemProperties } from '@/db/read/getItemProperties'
import { BaseDb } from '@/db/Db/BaseDb'
import { watchEntityRows } from '@/browser/db/changeFeed'
import {
  BaseFileManager,
  getCorrectId,
} from '@/helpers'
import { resolveStorageDisplay, storageSubdir, storedValueKind } from '@/storageValue/resolve'
import {
  getMetadataPropertyNamesForQuery,
  listRelationEasPropertyName,
  metadataRowPropertyKey,
  metadataStorageName,
  metadataStoredNameForms,
} from '@/helpers/metadataPropertyNames'
import { isActorStopped } from '@/helpers/entity/entityCommon'
import { EntityCache } from '@/helpers/entity/entityCache'
import {
  DEFAULT_READY_TIMEOUT_MS,
  destroyEntity,
  EntityUnloadedError,
  entityStatus,
  isEntityTornDown,
  onEntityTeardown,
  releaseEntity,
  runEntityLoad,
  teardownEntity,
  waitForEntityReady,
} from '@/helpers/entity/entityLifecycle'
import { whenDbReady } from '@/client/readiness'
import { loadProperty } from './loadProperty'
import { createSessionObjectUrl, isSessionObjectUrl, revokeSessionObjectUrl } from '@/helpers/sessionObjectUrls'
import { timed } from '@/helpers/timing'
import { eventEmitter } from '@/eventBus'
// Dynamic import to break circular dependency: schema/index -> ... -> ItemProperty -> schema/index
// Note: TProperty is used as a type, so we can import it separately. ModelPropertyDataTypes is used at runtime.
import type { TProperty } from '@/Schema'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import type { SetPropertyValueOp } from '@/outbox/itemAppliers'
import { rowContext } from './rowContext'
import {
  CLEARED_CONTEXT,
  appendPlannedWrite,
  isValidationLoaded,
  planPropertyWrite,
  propertyWriteKind,
  whenValidationLoaded,
  type PlannedWrite,
} from './propertyWrite'
import { getPropertyDefinitionsByFileId, propertyDefinitionFromRow } from '@/helpers/propertyDefinition'
import { addCachedPropertyRefresher } from '@/helpers/cachedPropertyRefresh'
import { isProduction } from '@/helpers/isProduction'
import type { PropertyType as PropertyRowType } from '@/seedSchema'
import {
  ModelPropertyDataTypes,
  isDataType,
  normalizeDataType,
  normalizePropertyRecordSchema,
} from '@/helpers/property'

/** Parent Html property `propertyValue` after publish (66-char seed uid). */
const HTML_PROP_SEED_UID_RE = /^0x[a-fA-F0-9]{64}$/

/**
 * A property's definition from its row (getPropertyDefinition): by property_id when known, else by
 * the owning model (resolved from the item's hints, the model name or its modelType) and the
 * property name or a stored form of it. A model created in this session whose rows aren't written
 * yet gives its in-memory definition.
 */
const resolvePropertyDefinition = async (
  modelName: string,
  propertyName: string,
  modelType?: string,
  /** Hints identifying the owning item's model (model names are only unique per schema). */
  hints: { modelFileId?: string | null; seedLocalId?: string | null; seedUid?: string | null; propertyId?: number | null } = {},
): Promise<SchemaPropertyType | undefined> => {
  if (!modelName && !modelType && hints.propertyId == null) {
    return undefined
  }
  try {
    if (hints.propertyId != null) {
      const { getPropertyDefinition } = await import('@/helpers/propertyDefinition')
      const definition = await getPropertyDefinition(hints.propertyId)
      if (definition) return definition as unknown as SchemaPropertyType
    }
    const { resolveItemModelFileId } = await import('@/db/read/resolveModelRecord')
    const { getModelPropertyDefinitions, resolvePropertyKey } = await import('@/helpers/property')
    const modelFileId = (await resolveItemModelFileId(hints)) ?? undefined
    const name = modelName || ((await modelTypeToModelName(modelType)) ?? '')
    // An ambiguous bare name reads nothing here; the in-memory model below may still know it
    const definitions = Object.fromEntries(
      name || modelFileId ? await getModelPropertyDefinitions(name || undefined, { modelFileId }).catch(() => []) : [],
    )
    const key = resolvePropertyKey(definitions, propertyName)
    if (key) return definitions[key] as unknown as SchemaPropertyType

    const { Model } = await import('@/Model/Model')
    const { modelPropertiesToObject } = await import('@/helpers/model')
    let model = modelName ? Model.peekByName(modelName) : undefined
    if (!model?.properties?.length && modelType) model = Model.findByModelType(modelType)
    if (!model?.properties?.length) return undefined
    const unwritten = modelPropertiesToObject(model.properties)
    const unwrittenKey = resolvePropertyKey(unwritten, propertyName)
    return unwrittenKey ? (unwritten[unwrittenKey] as SchemaPropertyType) : undefined
  } catch {
    return undefined
  }
}

/** The model a modelType (`metadata.model_type`, an EAS name) refers to, or undefined (none, or ambiguous). */
const modelTypeToModelName = async (modelType: string | undefined): Promise<string | undefined> => {
  if (!modelType) return undefined
  const { modelNameForType } = await import('@/db/read/resolveModelRecord')
  return modelNameForType(modelType).catch(() => undefined)
}

const logger = debug('seedSdk:property:class')

type ItemPropertyService = ActorRefFrom<typeof propertyMachine>
type ItemPropertySnapshot = SnapshotFrom<typeof propertyMachine>

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
const TRACKED_PROPERTIES = [
  // propertyName omitted: must use class getter so List-of-relation exposes schema key (_alias) while context keeps storage name
  'propertyValue',
  'renderValue',
  'seedLocalId',
  'seedUid',
  'modelName',
  'dataType',
  'refResolvedValue',
  'versionLocalId',
  'versionUid',
  'schemaUid',
  'localId',
  'uid',
] as const

// SDK-minted blob URLs a property's context has held, by actor (the raw instance and its proxy share
// one). An entry no context field references any more is revoked; the rest are revoked on unload.
const heldObjectUrls = new WeakMap<object, Set<string>>()

const trackHeldObjectUrls = (context: PropertyMachineContext, held: Set<string>) => {
  const referenced = new Set(
    [
      context.refResolvedDisplayValue,
      context.renderValue,
      context.propertyValue,
    ].filter(isSessionObjectUrl),
  )
  for (const url of held) {
    if (!referenced.has(url)) {
      held.delete(url)
      revokeSessionObjectUrl(url)
    }
  }
  for (const url of referenced) held.add(url)
}

const revokeHeldObjectUrls = (service: object) => {
  const held = heldObjectUrls.get(service)
  if (!held) return
  for (const url of held) revokeSessionObjectUrl(url)
  held.clear()
}

/** Thrown by ItemProperty.save() when the value failed validation (enum, pattern, minLength, maxLength). */
export class ItemPropertySaveValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: import('@/Schema/validation').ValidationError[],
  ) {
    super(message)
    this.name = 'ItemPropertySaveValidationError'
  }
}

/**
 * Thrown by ItemProperty.clear() for a Boolean or Date property: their EAS types have no empty value
 * to attest, so only a retraction can clear one (ADR 0021).
 */
export class ClearNotSupportedError extends Error {
  constructor(
    public readonly propertyName: string,
    public readonly dataType: string,
  ) {
    super(`${propertyName} can't be cleared: ${dataType} properties have no empty value. Use clear({ retract: true }).`)
    this.name = 'ClearNotSupportedError'
  }
}

/** Types whose value is a storage seed: an empty value is a clear, not a value to store. */
const STORAGE_SEED_TYPES = new Set(['Image', 'File', 'Html'])

/** How long a write waits for the client to set up the file system. */
const FILE_SYSTEM_WAIT_MS = 10_000

/** One assignment's write; `done` resolves once its op settled and the context shows the outcome. */
/** One assignment: settles when its op applies or fails. `opId` is set once the op is appended. */
type PropertyWrite = { done: Promise<void>; opId?: string }

/** A `save()` still waiting after this long logs a warning outside production (decision D30). */
const SLOW_SAVE_WARNING_MS = 10_000

/** A timer that doesn't keep a Node process running. */
function unrefTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms)
  ;(timer as { unref?: () => void }).unref?.()
  return timer
}

type ItemPropertyFindProps = {
  propertyName: string
  propertyLocalId?: string
  seedLocalId?: string
  seedUid?: string
  /** When metadata has no modelType, callers (e.g. Item) can pass modelName so ItemProperty.create can succeed */
  modelName?: string
}

type ItemPropertyHoldOption = {
  /**
   * Take a cache hold, released with `unload()`. `create` holds by default; `find` and `all` don't:
   * a property no one holds unloads after the grace period (`SeedConfig.entityCache.unloadGraceMs`).
   * SDK code that hands a new instance to an owner taking its own hold (an Item's property map)
   * creates it with false.
   */
  hold?: boolean
}

export class ItemProperty<PropertyType> implements IItemProperty<PropertyType> {
  /** Cached as `Item_<id>_<propertyName>` under its item's local id and seed uid. */
  static readonly cache = new EntityCache<ItemProperty<any>>()
  protected readonly _service: ItemPropertyService
  protected _subject: BehaviorSubject<any>
  protected readonly _isRelation: boolean = false
  protected readonly _isList: boolean = false
  protected readonly _alias: string | undefined
  protected _subscription: Subscription
  protected _dataType: string | undefined
  /** The latest assignment's write; save() waits for it. */
  protected _latestWrite: PropertyWrite | undefined
  /** Assignments waiting to append (see _assign), in order. */
  protected _writeQueue: Promise<void> | undefined
  /** Bumped by every assignment: a change-feed read begun before one is dropped. */
  protected _assignSeq = 0
  protected _schemaUid: string | undefined
  /** Name passed to the constructor; the public name if the machine later moves to a List-of-relation storage name. */
  protected readonly _constructedPropertyName: string | undefined

  constructor(initialValues: Partial<CreatePropertyInstanceProps>) {
    const { modelName, propertyName, propertyValue, seedLocalId, seedUid, versionLocalId, versionUid, storageTransactionId, schemaUid, refResolvedValue, refResolvedDisplayValue, localStorageDir, refSeedType } = initialValues
    // Fallback schema sources can hand us schema-file shape ({ type: 'html' }); everything below reads dataType.
    const propertyRecordSchema = normalizePropertyRecordSchema(initialValues.propertyRecordSchema)

    if (!modelName) {
      throw new Error('Model name is required')
    }

    if (!propertyName) {
      throw new Error(`Property name not provided`)
    }
    this._constructedPropertyName = propertyName

    // ItemProperty no longer depends on Model - property schema will be loaded from database
    // via loadOrCreateProperty actor or can be provided in initialValues
    const serviceInput: Partial<PropertyMachineContext> = {
      propertyValue,
      propertyName,
      seedLocalId,
      seedUid,
      versionLocalId,
      versionUid,
      modelName,
      modelFileId: initialValues.modelFileId,
      propertyId: initialValues.propertyId,
      storageTransactionId,
      // propertyRecordSchema will be loaded from database via loadOrCreateProperty actor
      // or can be provided in initialValues if available
      propertyRecordSchema,
      schemaUid,
      isSaving: false,
      isRelation: false,
      refResolvedValue,
      refResolvedDisplayValue,
      localStorageDir,
      refSeedType,
    }



    // Property schema will be loaded from database via loadOrCreateProperty actor
    // For now, use propertyRecordSchema from initialValues if provided
    if (propertyRecordSchema) {
      this._dataType = normalizeDataType(propertyRecordSchema.dataType)

      serviceInput.propertyRecordSchema = propertyRecordSchema

      if (isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.Relation)) {
        this._isRelation = true
      }

        if (isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.List)) {
        this._isList = true
        const listRef =
          propertyRecordSchema.ref ||
          (propertyRecordSchema as { refModelName?: string }).refModelName
        if (listRef) {
          this._isRelation = true
          const propertyNameSingular = pluralize(propertyName!, 1)
          this._alias = propertyName
          serviceInput.propertyName = `${propertyNameSingular}${listRef}Ids`
        }
        if (propertyValue) {
          try {
            serviceInput.propertyValue = JSON.parse(propertyValue)
          } catch (e) {
            logger('List property value is not JSON', e)
          }
        }
      }

      if (
        !this._alias &&
        propertyName.endsWith('Id') &&
        !PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP.has(propertyName)
      ) {
        this._alias = propertyName.slice(0, -2)
      } else if (!this._alias && propertyName.endsWith('Ids')) {
        this._alias = pluralize(propertyName.slice(0, -3))
      }
    }

    serviceInput.isRelation = this._isRelation

    this._subject = new BehaviorSubject(propertyValue)
    this._service = createActor(propertyMachine, {
      input: serviceInput as PropertyMachineContext,
    })

    // Synchronous and reading the latest snapshot: the async subscriber below can run on stale ones.
    const held = new Set<string>()
    heldObjectUrls.set(this._service, held)
    this._service.subscribe(() => trackHeldObjectUrls(this._service.getSnapshot().context, held))

    this._subscription = this._service.subscribe(
      async (snapshot: ItemPropertySnapshot) => {
        if (!snapshot || !snapshot.context) {
          return
        }

        // Use dynamic import to break circular dependency
        const schemaMod = await import('../Schema')
        const { ModelPropertyDataTypes } = schemaMod

        const { context } = snapshot
        const { propertyRecordSchema } = context

        // The context's ids or name can change after create (a seed uid arrives, a List of relation
        // moves to its storage name): key the instance by them too. Nothing once it was unloaded
        // (this runs after an await).
        if (context.propertyName && !isEntityTornDown(this)) {
          for (const id of [context.seedLocalId, context.seedUid]) {
            if (id) ItemProperty.cache.addKey(this, ItemProperty.cacheKey(id, context.propertyName))
          }
        }

        let renderValue
        // Set when this pass minted the display URL; stored with it so the next pass reuses it.
        let mintedDisplayValue: string | undefined

        const isImage =
          propertyRecordSchema &&
          isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.Image)

        const isFile =
          propertyRecordSchema &&
          isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.File)

        const isItemStorage = 
          propertyRecordSchema &&
          propertyRecordSchema.storageType &&
          propertyRecordSchema.storageType === 'ItemStorage' &&
          context.refResolvedValue &&
          context.localStorageDir

        const normalizedSchemaDt = normalizeDataType(propertyRecordSchema?.dataType)
        const isHtml =
          (context.refSeedType === 'html' || normalizedSchemaDt === ModelPropertyDataTypes.Html) &&
          context.refResolvedValue

        // Fix: When File/Image property has a File object before save completes, set refResolvedValue and renderValue
        // so the UI can display the filename and preview immediately (these update again when save completes)
        const pv = context.propertyValue
        const isFileValue = pv != null && (pv as unknown) instanceof File
        const isBlobValue = pv != null && (pv as unknown) instanceof Blob
        if (isFile && !context.refResolvedValue && isFileValue) {
          const fileName = (pv as unknown as File).name
          this._service.send({
            type: 'updateContext',
            refResolvedValue: fileName,
            renderValue: fileName,
            localStorageDir: '/files',
          })
        }
        if (isImage && !context.refResolvedValue && (isFileValue || isBlobValue)) {
          const fileOrBlob = pv as unknown as File | Blob
          const fileName = fileOrBlob instanceof File ? fileOrBlob.name : 'image'
          const blobUrl = createSessionObjectUrl(fileOrBlob)
          this._service.send({
            type: 'updateContext',
            refResolvedValue: fileName,
            renderValue: blobUrl,
            refResolvedDisplayValue: blobUrl,
            localStorageDir: '/images',
          })
        }

        if (!this._schemaUid && context.schemaUid) {
          this._schemaUid = context.schemaUid
        }

        // The file a stored value names: an Image or File shows a session URL (one already minted for
        // the same file is kept), Html and ItemStorage their text
        const fileKind = isImage ? 'image' : isFile ? 'file' : isItemStorage ? 'itemStorage' : isHtml ? 'html' : undefined
        if (fileKind && context.refResolvedValue) {
          try {
            let found: boolean
            if ((fileKind === 'image' || fileKind === 'file') && context.refResolvedDisplayValue) {
              const dir = storageSubdir(fileKind, context.localStorageDir)
              found = await BaseFileManager.pathExists(BaseFileManager.getFilesPath(dir, context.refResolvedValue))
              if (found) renderValue = context.refResolvedDisplayValue
            } else if (fileKind === 'itemStorage' && context.isSaving) {
              // This tab's assignment shows its content; its staged file may not have landed yet,
              // and the item's file still holds the previous content
              found = true
              renderValue = context.renderValue
            } else {
              // An ItemStorage value whose op is pending is in its staged file (ADR 0019)
              const { getPendingPropertyRow } = await import('@/outbox/pendingValues')
              const stagedPath =
                fileKind === 'itemStorage'
                  ? (await getPendingPropertyRow(context.seedLocalId, context.propertyName))?.stagedPath
                  : undefined
              const display = await resolveStorageDisplay(
                fileKind,
                {
                  propertyValue: typeof pv === 'string' ? pv : undefined,
                  refResolvedValue: context.refResolvedValue,
                  localStorageDir: context.localStorageDir,
                },
                { stagedPath },
              )
              found = display.renderValue !== undefined
              renderValue = display.renderValue
              if (found && (fileKind === 'image' || fileKind === 'file')) mintedDisplayValue = display.renderValue
            }
            if (!found) {
              // Keep filename for display when File object is present but not yet saved to disk
              if (isFile && isFileValue) {
                renderValue = (pv as unknown as File).name
              } else if (isImage || isHtml) {
                // FS race, OPFS cleared, or HTML served from Arweave: do not clobber hydrated/rehydrated value
                renderValue = undefined
              } else {
                renderValue = 'No file found'
              }
            }
          } catch (e) {
            logger(
              `[ItemProperty] [${context.seedLocalId}] [${context.propertyName}] [storageType] error`,
              e,
            )
            renderValue = isHtml ? undefined : 'No file found'
          }
        }

        if (!renderValue) {
          renderValue = context.renderValue || context.propertyValue
        }
        const pvStr = typeof context.propertyValue === 'string' ? context.propertyValue.trim() : ''
        if (
          normalizedSchemaDt === ModelPropertyDataTypes.Html &&
          HTML_PROP_SEED_UID_RE.test(pvStr) &&
          renderValue === pvStr &&
          typeof context.renderValue === 'string' &&
          context.renderValue.length > pvStr.length
        ) {
          renderValue = context.renderValue
        }

        let transformedPropertyName = propertyName

        const skipTransform =
          INTERNAL_PROPERTY_NAMES.includes(propertyName) || !!this._alias

        if (!skipTransform && transformedPropertyName.endsWith('Id')) {
          transformedPropertyName = transformedPropertyName.slice(0, -2)
        }

        if (!skipTransform && transformedPropertyName.endsWith('Ids')) {
          transformedPropertyName = transformedPropertyName.slice(0, -3)
        }

        if (skipTransform && this._alias) {
          transformedPropertyName = this._alias
        }

        if (skipTransform && !this._alias) {
        }

        // The context moved on while this pass awaited; the pass for the newer snapshot decides.
        // Sending here put back values (and revoked URLs) that the newer pass had replaced.
        if (this._service.getSnapshot().context !== context) {
          if (mintedDisplayValue) revokeSessionObjectUrl(mintedDisplayValue)
          return
        }

        // Update context with renderValue instead of BehaviorSubject
        // The reactive proxy will handle reactivity
        const currentRenderValue = context.renderValue || context.propertyValue
        if (currentRenderValue === renderValue) {
          return
        }

        // Update context with new renderValue. A minted URL goes into refResolvedDisplayValue too:
        // sent as renderValue alone, the next pass minted another, and so on about 60 times a second.
        this._service.send({
          type: 'updateContext',
          renderValue,
          ...(mintedDisplayValue ? { refResolvedDisplayValue: mintedDisplayValue } : {}),
        })
      },
    )

    this._service.start()
    // Assignments check values synchronously (planPropertyWrite)
    whenValidationLoaded().catch((error) => logger('[ItemProperty] loading validation', error))

    onEntityTeardown(this, () => {
      this._subscription?.unsubscribe()
      revokeHeldObjectUrls(this._service)
    })

    // Set up liveQuery subscription for cross-instance updates
    this._setupLiveQuerySubscription()
    this._setupPropertySchemaLiveQuery()
  }

  /**
   * Set up liveQuery subscription to watch for metadata changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    const isBrowser = typeof window !== 'undefined'
    const logger = debug('seedSdk:itemProperty:liveQuery')
    
    // Use a closure variable to track setup state per instance
    const setupState = { subscriptionSetUp: false }

    const setupLiveQuery = async (
      seedLocalId: string,
      seedUid: string | undefined,
      propertyName: string,
      versionLocalId: string | undefined,
      propertyRecordSchema?: SchemaPropertyType,
    ) => {
      if (setupState.subscriptionSetUp) {
        return
      }

      if (!seedLocalId && !seedUid) {
        logger('[ItemProperty._setupLiveQuerySubscription] No seedLocalId or seedUid')
        return
      }

      if (!propertyName) {
        logger('[ItemProperty._setupLiveQuerySubscription] No propertyName')
        return
      }

      setupState.subscriptionSetUp = true
      logger(`[ItemProperty._setupLiveQuerySubscription] Setting up liveQuery for propertyName: ${propertyName}, seedLocalId: ${seedLocalId}`)
      
      try {
        const normalizedDataType = normalizeDataType(propertyRecordSchema?.dataType)
        const normalizedRefValueType = normalizeDataType(propertyRecordSchema?.refValueType)
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[ItemProperty._setupLiveQuerySubscription] Database not available')
          return
        }

        // The property's rows: linked by property_id (decision D4), else stored under one of its names
        const { context: matchContext } = this._service.getSnapshot()
        const { matchMetadataProperty } = await import('@/db/read/metadataProperty')
        const property = await matchMetadataProperty(
          {
            propertyId: matchContext.propertyId,
            propertyName,
            modelName: matchContext.modelName,
            modelFileId: matchContext.modelFileId,
            seedLocalId,
            seedUid,
            dataType: normalizedDataType,
            refValueType: normalizedRefValueType,
          },
          db,
        )
        const propertyId = property.propertyId
        // The change feed reports writes by stored name: watch every name this property's rows have
        const propertyNames = [...property.names]
        if (propertyId != null) {
          const { metadata } = await import('@/seedSchema')
          const { eq: eqOp } = await import('drizzle-orm')
          const stored: { propertyName: string | null }[] = await db
            .selectDistinct({ propertyName: metadata.propertyName })
            .from(metadata)
            .where(eqOp(metadata.propertyId, propertyId))
          for (const { propertyName: name } of stored) {
            if (name && !propertyNames.includes(name)) propertyNames.push(name)
          }
        }

        // File and Image display values are session URLs minted from the file on disk; the column holds
        // nothing useful for them (older versions stored blob: URLs that die on reload). Keep the minted
        // one unless the row now points at a different file, then clear it so the next render mints anew.
        // A kept URL is also the renderValue: the row's propertyValue (the storage seed id) showed for a
        // moment on every write to the metadata table, then the subscriber put the URL back.
        // Html's stored display value is an unused session URL too (its display is the file's text).
        const displayValueFromRow = (row: { refResolvedValue?: string | null; refResolvedDisplayValue?: string | null }) => {
          const { context } = this._service.getSnapshot()
          const kind = storedValueKind(propertyRecordSchema, context)
          if (kind === 'html') return { refResolvedDisplayValue: undefined }
          if (kind !== 'image' && kind !== 'file') {
            return { refResolvedDisplayValue: row.refResolvedDisplayValue || undefined }
          }
          if ((row.refResolvedValue || undefined) === context.refResolvedValue) {
            return context.refResolvedDisplayValue ? { renderValue: context.refResolvedDisplayValue } : {}
          }
          return { refResolvedDisplayValue: undefined }
        }

        // A row with no value and no file is a cleared property (ADR 0021), here or synced from
        // another device: drop the storage transaction id too, or the old file's gateway URL shows.
        const clearedFromRow = (row: { propertyValue?: string | null; refResolvedValue?: string | null }) =>
          row.propertyValue == null && !row.refResolvedValue ? { storageTransactionId: undefined } : {}

        // The current row with the pending outbox value over it (ADR 0019, decision D2), and the
        // property's recorded conflict: sync records one when it writes a row over a local draft.
        // A pending edit settles the conflict when it applies, so an overlaid row shows none.
        // `assignSeq` marks a read begun before an assignment in this tab: it may predate that op,
        // which the context already shows, so the feed drops it.
        // Sync records a conflict and moves its draft to newest in one transaction, so a row read
        // before the conflict may be the synced one: read the row again once a conflict shows.
        const readRow = async () => {
          const assignSeq = this._assignSeq
          const read = () =>
            currentPropertyRow({ seedLocalId, seedUid }, { match: property, propertyName }, { overlay: true, db })
          let row = await read()
          if (!row) return row
          const conflict = row.overlaid ? null : await getPropertyConflict(row.seedLocalId ?? seedLocalId, propertyName)
          if (conflict) row = (await read()) ?? row
          return { ...row, conflict, assignSeq }
        }

        // In the browser the feed watch below reads the row at once, so only Node (no change feed)
        // reads it here.
        const contextBeforeRead = this._service.getSnapshot().context
        const initialRow = isBrowser ? undefined : await readRow()
        // The load or an assignment changed the context while this read ran: theirs is newer
        if (initialRow && this._service.getSnapshot().context === contextBeforeRead) {
          logger(`[ItemProperty._setupLiveQuerySubscription] Initial query returned metadata record`)
          this._service.send({
            type: 'updateContext',
            propertyValue: initialRow.propertyValue,
            renderValue: initialRow.propertyValue,
            localId: initialRow.localId || undefined,
            uid: initialRow.uid || undefined,
            versionLocalId: initialRow.versionLocalId || undefined,
            versionUid: initialRow.versionUid || undefined,
            schemaUid: initialRow.schemaUid || undefined,
            refResolvedValue: initialRow.refResolvedValue || undefined,
            ...displayValueFromRow(initialRow),
            ...clearedFromRow(initialRow),
            localStorageDir: initialRow.localStorageDir || undefined,
            conflict: initialRow.conflict,
          })
        }

        // Only watch for changes in the browser (the change feed is browser-only)
        if (isBrowser) {
          // Unloaded or destroyed while setup awaited: watching now would leak the watch.
          if (isEntityTornDown(this) || isActorStopped(this._service)) return

          // Re-read on each change to this property's metadata rows (ADR 0020)
          const subscription = watchEntityRows(
            {
              seedLocalId: seedLocalId || null,
              seedUid: seedUid || null,
              tables: ['metadata'],
              propertyNames,
            },
            readRow,
            (metaRow) => {
              if (!metaRow) return
              logger(`[ItemProperty._setupLiveQuerySubscription] Metadata updated in database for propertyName: ${propertyName}`)

              if (metaRow.assignSeq !== this._assignSeq) return
              const { context } = this._service.getSnapshot()
              const rowIdentity = {
                localId: metaRow.localId || undefined,
                uid: metaRow.uid || undefined,
                versionLocalId: metaRow.versionLocalId || undefined,
                versionUid: metaRow.versionUid || undefined,
                schemaUid: metaRow.schemaUid || undefined,
                conflict: metaRow.conflict,
              }
              // The value the context shows is the pending one: keep its display (a session URL,
              // Html text), which the row can't give until the op applies
              if (metaRow.overlaid && metaRow.propertyValue === context.propertyValue) {
                this._service.send({ type: 'updateContext', ...rowIdentity })
                return
              }

              // An ItemStorage row that points at its file holds no content: keep the value shown until
              // the pass this update starts reads the file. Taking renderValue from the row showed null
              // in between, e.g. when publish moved a legacy verbatim row's content to its file.
              // An Html row's value is its storage seed's id: the subscriber shows the file's text.
              const kind = storedValueKind(context.propertyRecordSchema, context)
              // A pending ItemStorage value is in its staged file, which the subscriber reads.
              const contentInFile =
                (((kind === 'itemStorage' && metaRow.propertyValue == null) || kind === 'html') &&
                  !!metaRow.refResolvedValue) ||
                metaRow.stagedPath !== undefined

              // Update context with metadata changes
              this._service.send({
                type: 'updateContext',
                propertyValue: metaRow.propertyValue,
                ...(metaRow.pendingText !== undefined
                  ? { renderValue: metaRow.pendingText }
                  : contentInFile
                    ? {}
                    : { renderValue: metaRow.propertyValue }),
                ...rowIdentity,
                refResolvedValue: metaRow.refResolvedValue || undefined,
                ...displayValueFromRow(metaRow),
                ...clearedFromRow(metaRow),
                localStorageDir: metaRow.localStorageDir || undefined,
              })
            },
            {
              immediate: true,
              onError: (error) => logger(`[ItemProperty._setupLiveQuerySubscription] Metadata read error: ${error}`),
            },
          )

          onEntityTeardown(this, () => subscription.unsubscribe())
          logger(`[ItemProperty._setupLiveQuerySubscription] LiveQuery subscription set up for propertyName: ${propertyName}`)
        } else {
          logger(`[ItemProperty._setupLiveQuerySubscription] Skipping liveQuery subscription in Node.js environment`)
        }
      } catch (error) {
        logger(`[ItemProperty._setupLiveQuerySubscription] Error setting up subscription: ${error}`)
        setupState.subscriptionSetUp = false // Reset on error so we can retry
      }
    }

    // Set up liveQuery subscription as soon as we have required context
    const setupSubscription = this._service.subscribe(async (snapshot) => {
      const seedLocalId = snapshot.context.seedLocalId
      const seedUid = snapshot.context.seedUid
      const propertyName = snapshot.context.propertyName
      const versionLocalId = snapshot.context.versionLocalId
      const propertyRecordSchema = snapshot.context.propertyRecordSchema
      
      if ((!seedLocalId && !seedUid) || !propertyName) {
        return // Need seed ID and propertyName to proceed
      }

      // Once we have required context, set up the liveQuery subscription (only once)
      if ((seedLocalId || seedUid) && propertyName && !setupState.subscriptionSetUp) {
        await setupLiveQuery(seedLocalId || '', seedUid || undefined, propertyName, versionLocalId || undefined, propertyRecordSchema)
        if (setupState.subscriptionSetUp) {
          setupSubscription.unsubscribe()
        }
      }
    })
    
    // Also check current state immediately in case context is already available
    const currentSnapshot = this._service.getSnapshot()
    const seedLocalId = currentSnapshot.context.seedLocalId
    const seedUid = currentSnapshot.context.seedUid
    const propertyName = currentSnapshot.context.propertyName
    const versionLocalId = currentSnapshot.context.versionLocalId
    const propertyRecordSchema = currentSnapshot.context.propertyRecordSchema
    
    if ((seedLocalId || seedUid) && propertyName && !setupState.subscriptionSetUp) {
      setupLiveQuery(seedLocalId || '', seedUid || undefined, propertyName, versionLocalId || undefined, propertyRecordSchema).catch((error) => {
        logger(`[ItemProperty._setupLiveQuerySubscription] Error in immediate setup: ${error}`)
      })
    }
  }

  /** Takes a property definition read from its row, as the constructor takes the initial one. */
  private _applyDefinition(propertyRecordSchema: SchemaPropertyType): void {
    this._service.send({ type: 'updateContext', propertyRecordSchema })
    this._dataType = normalizeDataType(propertyRecordSchema.dataType)
    const isList = isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.List)
    ;(this as any)._isList = isList
    ;(this as any)._isRelation = isList
      ? !!propertyRecordSchema.ref
      : isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.Relation)
  }

  /**
   * Gives cached instances of these properties their rows' current definitions, after a schema
   * change wrote the rows (refreshCachedProperties). An instance keeps the definition it loaded
   * with otherwise: Node has no live query, and the browser's arrives some time after the write.
   */
  static async refreshDefinitions(propertyFileIds: string[]): Promise<void> {
    const instances = this.cache.instances().filter((instance) => !isActorStopped(instance._service))
    if (instances.length === 0) return
    const definitions = await getPropertyDefinitionsByFileId(propertyFileIds)
    for (const instance of instances) {
      const fileId = instance._getSnapshotContext().propertyRecordSchema?.id
      const definition = fileId ? definitions.get(fileId) : undefined
      if (definition) instance._applyDefinition(definition as SchemaPropertyType)
    }
  }

  /**
   * Set up liveQuery subscription to watch for property schema changes in the properties table.
   * When ModelProperty dataType (or other schema fields) changes in the database, ItemProperty
   * receives the update and refreshes its propertyRecordSchema.
   */
  private _setupPropertySchemaLiveQuery(): void {
    const isBrowser = typeof window !== 'undefined'
    const logger = debug('seedSdk:itemProperty:schemaLiveQuery')

    const setupState = { subscriptionSetUp: false }

    const setupSchemaLiveQuery = async (modelName: string, propertyName: string) => {
      if (setupState.subscriptionSetUp) return
      if (!modelName || !propertyName) return

      setupState.subscriptionSetUp = true
      logger(`[ItemProperty._setupPropertySchemaLiveQuery] Setting up for modelName: ${modelName}, propertyName: ${propertyName}`)
      // Model names are only unique per schema; pin the query to the owning item's model when known.
      const ctx = this._service.getSnapshot().context
      let modelFileId: string | undefined
      try {
        const { resolveItemModelFileId } = await import('../db/read/resolveModelRecord')
        modelFileId = await resolveItemModelFileId({
          modelFileId: ctx.modelFileId,
          seedLocalId: ctx.seedLocalId,
          seedUid: ctx.seedUid,
          propertyId: ctx.propertyId,
        })
      } catch {
        modelFileId = undefined
      }

      try {
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[ItemProperty._setupPropertySchemaLiveQuery] Database not available')
          return
        }

        if (!isBrowser) {
          logger('[ItemProperty._setupPropertySchemaLiveQuery] Skipping in Node.js environment')
          return
        }

        // The row by property_id when known; else by name, which for a List of relations is the
        // property's key, not the instance's stored name
        const propertyId = ctx.propertyId ?? null
        const schema$ = BaseDb.liveQuery<PropertyRowType & { refModelName: string | null }>(
          (sql: any) => sql`
            SELECT p.id as id, p.name as name, p.data_type as dataType, p.model_id as modelId,
              p.ref_model_id as refModelId, p.ref_value_type as refValueType,
              p.schema_file_id as schemaFileId, p.is_edited as isEdited, p.required as required,
              p.storage_type as storageType, p.local_storage_dir as localStorageDir,
              p.filename_suffix as filenameSuffix, p.definition as definition, ref.name as refModelName
            FROM properties p
            INNER JOIN models m ON p.model_id = m.id
            LEFT JOIN models ref ON p.ref_model_id = ref.id
            WHERE (CASE WHEN ${propertyId} IS NOT NULL THEN p.id = ${propertyId}
              ELSE p.name IN (${propertyName}, ${this.propertyName || propertyName})
                AND (CASE WHEN ${modelFileId ?? null} IS NOT NULL
                  THEN m.schema_file_id = ${modelFileId ?? null}
                  ELSE m.name = ${modelName} END) END)
            ORDER BY m.id DESC
            LIMIT 1
          `
        )

        // Unloaded or destroyed while setup awaited: subscribing now would leak the query.
        if (isEntityTornDown(this) || isActorStopped(this._service)) return

        const subscription = schema$.subscribe({
          next: (rows) => {
            if (rows.length === 0) return

            const { refModelName, ...row } = rows[0]
            const required = row.required as unknown
            const propertyRecordSchema = propertyDefinitionFromRow(
              { ...row, required: required == null ? null : !!required },
              refModelName,
            )

            logger(`[ItemProperty._setupPropertySchemaLiveQuery] Schema updated for ${propertyName}: dataType=${row.dataType}`)
            this._applyDefinition(propertyRecordSchema)
          },
          error: (error) => {
            logger(`[ItemProperty._setupPropertySchemaLiveQuery] LiveQuery error: ${error}`)
          },
        })

        onEntityTeardown(this, () => subscription.unsubscribe())
        logger(`[ItemProperty._setupPropertySchemaLiveQuery] Subscription set up for ${modelName}.${propertyName}`)
      } catch (error) {
        logger(`[ItemProperty._setupPropertySchemaLiveQuery] Error: ${error}`)
        setupState.subscriptionSetUp = false
      }
    }

    const setupSubscription = this._service.subscribe((snapshot) => {
      const modelName = snapshot.context.modelName
      const propertyName = snapshot.context.propertyName

      if (!modelName || !propertyName) return
      if (!setupState.subscriptionSetUp) {
        setupSchemaLiveQuery(modelName, propertyName)
        if (setupState.subscriptionSetUp) {
          setupSubscription.unsubscribe()
        }
      }
    })

    const currentSnapshot = this._service.getSnapshot()
    const modelName = currentSnapshot.context.modelName
    const propertyName = currentSnapshot.context.propertyName

    if (modelName && propertyName && !setupState.subscriptionSetUp) {
      setupSchemaLiveQuery(modelName, propertyName).catch((error) => {
        logger(`[ItemProperty._setupPropertySchemaLiveQuery] Error in immediate setup: ${error}`)
      })
    }
  }

  /**
   * The cached instance for this item and property, or a new one. Takes a hold on it: release it
   * with `unload()`. An Item holds the properties in its own map and releases them when it unloads.
   */
  static create(
    props: Partial<CreatePropertyInstanceProps>,
    options: { waitForReady: false } & ItemPropertyHoldOption,
  ): ItemProperty<any> | undefined
  static create(
    props: Partial<CreatePropertyInstanceProps>,
    options?: { waitForReady?: true; readyTimeout?: number } & ItemPropertyHoldOption,
  ): Promise<ItemProperty<any> | undefined>
  static create(
    props: Partial<CreatePropertyInstanceProps>,
    options?: CreateWaitOptions & ItemPropertyHoldOption,
  ): ItemProperty<any> | undefined | Promise<ItemProperty<any> | undefined> {
    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS
    const holds = options?.hold === false ? 0 : 1

    const { propertyName, seedLocalId, seedUid } =
      props
    if (!propertyName || (!seedLocalId && !seedUid)) {
      if (!waitForReady) return undefined
      return Promise.resolve(undefined)
    }
    const keyByLocal = seedLocalId ? this.cacheKey(seedLocalId, propertyName) : null
    const keyByUid = seedUid ? this.cacheKey(seedUid, propertyName) : null
    // Under either id: an instance made before publish is keyed by the local id only
    const cached = this.cache.peek(keyByLocal) ?? this.cache.peek(keyByUid)
    if (cached) {
      if (holds) this.cache.holdInstance(cached)
      else this.cache.keepUnheld(cached)
      for (const key of [keyByLocal, keyByUid]) this.cache.addKey(cached, key)
      this.syncFromRow(cached, props)
      // On cache hit, do not sync propertyValue: refetches can race with in-memory updates (e.g. save()).
      if (!waitForReady) return cached
      return waitForEntityReady(cached, { timeout: readyTimeout }).then(() => cached)
    }

    const proxiedInstance = ItemProperty.wrapInProxy(new ItemProperty(props))
    this.cache.add(proxiedInstance, [keyByLocal, keyByUid], { hold: holds === 1 })
    void runEntityLoad(proxiedInstance, () => ItemProperty.load(proxiedInstance))
    if (!waitForReady) return proxiedInstance
    return waitForEntityReady(proxiedInstance, { timeout: readyTimeout }).then(() => proxiedInstance)
  }

  /** Load the property's row and definition into its context. */
  private static async load(instance: ItemProperty<any>): Promise<void> {
    if (!(await whenDbReady(10_000))) throw new Error('Database not available after timeout')
    const property = await loadProperty(instance._getSnapshotContext())
    if (isEntityTornDown(instance)) return
    instance._service.send({ type: 'loaded', property })
  }

  /**
   * A cached instance asked for again with a row's fields: take the display and storage fields it
   * doesn't have yet (the Item constructor created it from the schema, then the load has the
   * row's refResolvedValue), and re-read its row when it looks stale.
   * @internal
   */
  static syncFromRow(instance: ItemProperty<any>, props: Partial<CreatePropertyInstanceProps>): void {
    const ctx = instance._getSnapshotContext()
    const incomingSchema = normalizePropertyRecordSchema(props.propertyRecordSchema)
    if (incomingSchema && !ctx.propertyRecordSchema) {
      ;instance._dataType = normalizeDataType(incomingSchema.dataType)
      ;(instance as any)._isRelation = isDataType(incomingSchema.dataType, ModelPropertyDataTypes.Relation)
      ;(instance as any)._isList = isDataType(incomingSchema.dataType, ModelPropertyDataTypes.List)
      ;instance._service.send({
        type: 'updateContext',
        propertyRecordSchema: incomingSchema,
      })
    }
    const needsRefSync =
      (props.refResolvedValue != null && !ctx.refResolvedValue) ||
      (props.refResolvedDisplayValue != null && !ctx.refResolvedDisplayValue) ||
      (props.localStorageDir != null && !ctx.localStorageDir) ||
      (props.refSeedType != null && !ctx.refSeedType)
    if (needsRefSync) {
      const updates: Record<string, unknown> = {}
      if (props.refResolvedValue != null && !ctx.refResolvedValue) updates.refResolvedValue = props.refResolvedValue
      if (props.refResolvedDisplayValue != null && !ctx.refResolvedDisplayValue) updates.refResolvedDisplayValue = props.refResolvedDisplayValue
      if (props.localStorageDir != null && !ctx.localStorageDir) updates.localStorageDir = props.localStorageDir
      if (props.refSeedType != null && !ctx.refSeedType) updates.refSeedType = props.refSeedType
      if (Object.keys(updates).length) {
        instance._service.send({ type: 'updateContext', ...updates })
      }
    }
    // After wipe/reconnect, cached actors can stay idle with stale renderValue while DB + Arweave
    // paths would hydrate. Re-run DB hydration without clobbering propertyValue.
    const svc = instance._service
    const snap = svc.getSnapshot() as { status?: string; value?: unknown }
    if (snap.status === 'active' && snap.value === 'idle' && entityStatus(instance) === 'ready') {
      const schema = props.propertyRecordSchema ?? ctx.propertyRecordSchema
      const dt = normalizeDataType(schema?.dataType as string | undefined)
      const isHtmlProp =
        (props as { refSeedType?: string }).refSeedType === 'html' ||
        ctx.refSeedType === 'html' ||
        dt === ModelPropertyDataTypes.Html
      const isListProp = dt === ModelPropertyDataTypes.List
      const isRelationProp = dt === ModelPropertyDataTypes.Relation
      const pv = ctx.propertyValue
      const pvStr = typeof pv === 'string' ? pv.trim() : ''
      const renderVal = ctx.renderValue
      const renderMissing =
        renderVal == null || (typeof renderVal === 'string' && renderVal.length === 0)
      const htmlStuckOnUid =
        isHtmlProp &&
        HTML_PROP_SEED_UID_RE.test(pvStr) &&
        (renderMissing || renderVal === pv)
      const pvPresent =
        pv != null &&
        (Array.isArray(pv) ? pv.length > 0 : String(pv).trim().length > 0)
      const listOrRelationNeedsResolve =
        (isListProp || isRelationProp) && renderMissing && pvPresent
      const versionChanged =
        props.versionLocalId != null &&
        ctx.versionLocalId != null &&
        props.versionLocalId !== ctx.versionLocalId

      if (htmlStuckOnUid || listOrRelationNeedsResolve || versionChanged) {
        svc.send({ type: 'rehydrateFromDb' })
      }
    }
  }

  /**
   * Wraps a new instance in its reactive proxy: tracked names read from and write to the actor's
   * context, and assigning `value` also sends it to the actor before the setter runs.
   */
  private static wrapInProxy(instance: ItemProperty<any>): ItemProperty<any> {
    const sendUpdate = (target: ItemProperty<any>, prop: string, value: unknown) => {
      target._service.send({ type: 'updateContext', [prop]: value })
    }
    return createReactiveProxy<ItemProperty<any>>({
      instance,
      service: instance._service,
      trackedProperties: TRACKED_PROPERTIES,
      getContext: (target) => target._getSnapshotContext(),
      sendUpdate,
      onSet: (target, prop, value) => {
        if (prop === 'value') sendUpdate(target, prop, value)
      },
    })
  }

  /**
   * The cached ItemProperty when it can be read right now (loaded: `status` ready), the state
   * `ItemProperty.find()` waits for. Otherwise undefined. Unlike `find`, it takes no cache hold, so
   * React hooks can call it during render.
   */
  static peekReady({
    propertyName,
    seedLocalId,
    seedUid,
  }: {
    propertyName?: string
    seedLocalId?: string
    seedUid?: string
  }): ItemProperty<any> | undefined {
    if (!propertyName) return undefined
    // Same key order as find(), then the other id: instances are cached under both when both are known.
    const keys = [seedUid, seedLocalId]
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => this.cacheKey(id, propertyName))
    for (const key of keys) {
      const instance = this.cache.peek(key)
      if (!instance) continue
      return entityStatus(instance) === 'ready' && instance.getService().getSnapshot().status === 'active'
        ? instance
        : undefined
    }
    return undefined
  }

  /**
   * The property's instance, loaded from its row when it isn't cached. Takes no hold unless
   * `hold: true` (release it with `unload()`).
   */
  static async find({
    propertyName,
    seedLocalId,
    seedUid,
    modelName: modelNameOption,
    waitForReady = true,
    readyTimeout = DEFAULT_READY_TIMEOUT_MS,
    hold = false,
  }: ItemPropertyFindProps & {
    waitForReady?: boolean
    readyTimeout?: number
  } & ItemPropertyHoldOption): Promise<ItemProperty<any> | undefined> {
    if ((!seedLocalId && !seedUid) || !propertyName) {
      return undefined
    }
    
    const keyByLocal = seedLocalId ? ItemProperty.cacheKey(seedLocalId, propertyName) : null
    const keyByUid = seedUid ? ItemProperty.cacheKey(seedUid, propertyName) : null
    let foundProperty: ItemProperty<any> | undefined

    // Check cache first, under both ids: an instance made before publish is keyed by the local id
    // only. Missing it here, an Image, File, Html or Relation would come back from its row under
    // the stored name (`coverImageId`) as a second instance, and the item would swap it in and
    // unload the first one mid-save. Mutate the entry: it is shared by both keys.
    const fromCache = (): ItemProperty<any> | undefined => {
      const cached = this.cache.peek(keyByLocal) ?? this.cache.peek(keyByUid)
      if (!cached) return undefined
      for (const key of [keyByLocal, keyByUid]) this.cache.addKey(cached, key)
      if (hold) this.cache.holdInstance(cached)
      else this.cache.keepUnheld(cached)
      return cached
    }
    foundProperty = fromCache()
    if (!foundProperty) {
      // Query database
      const row = await currentPropertyRow(
        { seedLocalId, seedUid },
        { propertyName, modelName: modelNameOption },
        { overlay: false },
      )
      if (!row) {
        return undefined
      }
      const { overlaid: _overlaid, stagedPath: _stagedPath, ...rowFields } = row
      const propertyData = rowFields as Partial<CreatePropertyInstanceProps>
      // Ensure modelName for constructor: metadata may have modelType only, or neither (e.g. when Item passes it)
      // modelType is the EAS name ("test_post"); modelTypeToModelName finds the model it names
      const data = propertyData as { modelName?: string; modelType?: string }
      const modelName =
        data.modelName ?? ((await modelTypeToModelName(data.modelType)) || modelNameOption || '')
      // The definition, so the value setter can persist (useItemProperty path)
      const propertyRecordSchema = await resolvePropertyDefinition(
        modelName,
        propertyName,
        data.modelType,
        {
          seedLocalId: (propertyData as { seedLocalId?: string }).seedLocalId ?? seedLocalId,
          seedUid: (propertyData as { seedUid?: string }).seedUid ?? seedUid,
          propertyId: (propertyData as { propertyId?: number }).propertyId,
        },
      )
      // The row's stored name when it is a form of the name asked for (`avatarImageId` for
      // `avatarImage`); else the row is the property's under an older name (a rename keeps rows'
      // names, decision D4) and the instance takes the name asked for.
      const storedName = (propertyData as { propertyName?: string }).propertyName
      const keepsStoredName =
        !!storedName &&
        (metadataStoredNameForms(propertyName, propertyRecordSchema as never).includes(storedName) ||
          getMetadataPropertyNamesForQuery(propertyName).includes(storedName))
      // The item may have made the instance while the reads ran. Under the stored name, `create`
      // wouldn't match it and would make a second one.
      foundProperty = fromCache() ?? ItemProperty.create(
        { ...propertyData, propertyName: keepsStoredName ? storedName : propertyName, modelName, propertyRecordSchema },
        { waitForReady: false, hold },
      )
    }

    if (!foundProperty) {
      return undefined
    }

    if (waitForReady) {
      await waitForEntityReady(foundProperty, { timeout: readyTimeout })
    }

    return foundProperty
  }

  /**
   * Get all ItemProperty instances for an item.
   * Loads property data via getItemProperties, creates instances via create, optionally waits for idle.
   * Takes no holds unless `hold: true`, as `find`.
   */
  static async all(
    params: { seedLocalId?: string; seedUid?: string },
    options?: { waitForReady?: boolean; readyTimeout?: number } & ItemPropertyHoldOption,
  ): Promise<ItemProperty<any>[]> {
    const { waitForReady = false, readyTimeout = DEFAULT_READY_TIMEOUT_MS, hold = false } = options ?? {}
    const { seedLocalId, seedUid } = params
    if (!seedLocalId && !seedUid) {
      return []
    }

    const propertiesData = await getItemProperties({ seedLocalId, seedUid })
    const instances: ItemProperty<any>[] = []
    const seenNormalized = new Set<string>()

    const { resolveItemModelFileId } = await import('../db/read/resolveModelRecord')
    const itemModelFileId = await resolveItemModelFileId({ seedLocalId, seedUid })
    // One lookup per model type, not per property
    const modelNameByType = new Map<string, Promise<string | undefined>>()
    const definitionsByModel = new Map<string, Promise<Record<string, any>>>()
    const modelNameOfType = (modelType: string | undefined): Promise<string | undefined> => {
      if (!modelType) return Promise.resolve(undefined)
      if (!modelNameByType.has(modelType)) modelNameByType.set(modelType, modelTypeToModelName(modelType))
      return modelNameByType.get(modelType)!
    }
    for (const data of propertiesData) {
      const d = data as {
        modelName?: string
        modelType?: string
        propertyName?: string
        propertyKey?: string | null
        refSeedType?: string
        propertyId?: number
      }
      const modelName = d.modelName ?? (await modelNameOfType(d.modelType)) ?? ''
      const modelFileId =
        itemModelFileId ?? (await resolveItemModelFileId({ propertyId: d.propertyId }))
      // The property's key: through property_id when the row has one, else from its stored name
      // (`textId` → `text`, `authorIdentityIds` → `authors`)
      const definitionsKey = JSON.stringify([modelName, modelFileId ?? null])
      if (modelName && !definitionsByModel.has(definitionsKey)) {
        const { getModelPropertyDefinitions } = await import('../helpers/property')
        definitionsByModel.set(
          definitionsKey,
          // No model row: the stored name decides
          getModelPropertyDefinitions(modelName, { modelFileId }).then(Object.fromEntries, () => ({})),
        )
      }
      const schemas: Record<string, any> = modelName ? await definitionsByModel.get(definitionsKey)! : {}
      const propertyName = metadataRowPropertyKey(d, schemas) ?? ''
      if (seenNormalized.has(propertyName)) continue
      seenNormalized.add(propertyName)
      const propertyRecordSchema = propertyName
        ? (schemas[propertyName] ??
          (await resolvePropertyDefinition(modelName, propertyName, d.modelType, { modelFileId, propertyId: d.propertyId })))
        : undefined
      const createProps = {
        ...data,
        propertyName,
        modelName,
        modelFileId,
        propertyRecordSchema,
      }
      const instance = this.create(createProps, { waitForReady: false, hold })
      if (instance) {
        instances.push(instance)
      }
    }

    if (waitForReady && instances.length > 0) {
      await Promise.all(instances.map((property) => waitForEntityReady(property, { timeout: readyTimeout })))
    }

    return instances
  }

  find = ItemProperty.find

  /**
   * @internal Takes one more hold on a cached, running instance, released with `unload()`. False
   * (and no hold) when the instance isn't cached or was stopped.
   */
  static retain(instance: IItemProperty<any>): boolean {
    const property = instance as ItemProperty<any>
    return property.getService().getSnapshot().status === 'active' && this.cache.holdInstance(property)
  }

  /** The cached properties of an item (by its local id or seed uid). */
  private static cachedForItem(seedIds: Array<string | null | undefined>): ItemProperty<any>[] {
    const prefixes = seedIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => this.cacheKey(id, ''))
    if (prefixes.length === 0) return []
    return this.cache.instances((property) =>
      this.cache.keysOf(property).some((key) => prefixes.some((prefix) => key.startsWith(prefix))),
    )
  }

  /**
   * Stops an item's cached properties that nobody holds. Internal lookups cache a property without
   * a hold for the item to take; one that finished after the item stopped (a liveQuery handler's
   * find, say) never got that hold and would otherwise keep running. Called when the item stops.
   */
  static unloadUnheldForItem(seedIds: Array<string | null | undefined>): void {
    for (const property of this.cachedForItem(seedIds)) {
      if ((this.cache.entryOf(property)?.refCount ?? 0) <= 0) teardownEntity(property, this.cache)
    }
  }

  static cacheKey(seedLocalIdOrUid: string, propertyName: string): string {
    const { uid, localId } = getCorrectId(seedLocalIdOrUid)
    return `Item_${uid || localId}_${propertyName}`
  }

  /**
   * Drops an item's properties from the instance cache, under every key they're cached by. A dropped
   * instance someone still holds keeps running but is detached: it doesn't re-key itself into the
   * cache when its context changes, so the next lookup creates a fresh instance.
   */
  static clearInstanceCacheForItem(seedLocalIdOrUid: string): void {
    for (const property of this.cachedForItem([seedLocalIdOrUid])) this.cache.remove(property)
  }

  getService() {
    return this._service
  }

  private _getSnapshot(): ItemPropertySnapshot {
    return this._service.getSnapshot() as ItemPropertySnapshot
  }

  private _getSnapshotContext(): PropertyMachineContext {
    return this._getSnapshot().context
  }

  get localId() {
    return this._getSnapshotContext().localId ?? ''
  }

  get uid() {
    return this._getSnapshotContext().uid ?? ''
  }

  get seedLocalId() {
    return this._getSnapshotContext().seedLocalId ?? ''
  }

  get seedUid() {
    return this._getSnapshotContext().seedUid ?? ''
  }

  get schemaUid(): string | undefined {
    return this._getSnapshotContext().schemaUid || undefined
  }

  get propertyName(): string {
    if (this._alias) {
      return this._alias
    }
    const context = this._getSnapshotContext()
    const name = context.propertyName || ''
    // Built under its schema key before the schema was known, then renamed to the storage name
    // (staff → staffIdentityIds) when a List-of-relation schema arrived: keep the schema key public.
    if (
      this._constructedPropertyName &&
      name !== this._constructedPropertyName &&
      listRelationEasPropertyName(this._constructedPropertyName, context.propertyRecordSchema) === name
    ) {
      return this._constructedPropertyName
    }
    return name
  }

  /**
   * The name new metadata rows of this property are stored under (`metadataStorageName`): `authorId`
   * for a single Relation `author`, `authorIdentityIds` for a List of Relation `authors`, the key
   * otherwise. Use it for storage; `propertyName` is the public name.
   */
  get storagePropertyName(): string {
    const name = this.propertyName
    return name ? metadataStorageName(name, this._getSnapshotContext().propertyRecordSchema) : ''
  }

  get modelName() {
    return this._getSnapshotContext().modelName
  }

  get propertyDef(): Static<typeof TProperty> | undefined {
    return this._getSnapshotContext().propertyRecordSchema
  }

  get localStorageDir(): string | void {
    const propertyDef = this.propertyDef
    if (propertyDef && propertyDef.localStorageDir) {
      return this.propertyDef.localStorageDir
    }
    const localStorageDir = this._getSnapshot().context.localStorageDir
    if (localStorageDir) {
      return localStorageDir
    }
  }

  get refResolvedValue(): string | undefined {
    return this._getSnapshotContext().refResolvedValue || undefined
  }

  get localStoragePath(): string | void {
    if (this.localStorageDir && this.refResolvedValue) {
      const dir = this.localStorageDir.replace(/^\//, '')
      return BaseFileManager.getFilesPath(dir, this.refResolvedValue)
    }
  }

  get versionLocalId(): string | undefined {
    return this._getSnapshotContext().versionLocalId || undefined
  }

  /** `loading` until its row and definition are loaded, then `ready` or `error`. Was the machine state ('idle'). */
  get status() {
    return entityStatus(this)
  }

  /** Resolves once `status` is `ready`; rejects when the load failed or `timeout` ms pass. */
  waitForReady(options?: { timeout?: number }): Promise<void> {
    return waitForEntityReady(this, options)
  }

  /** Validation errors from the last refused write (enum, pattern, minLength, maxLength). Cleared by the next assignment. */
  get saveValidationErrors(): import('@/Schema/validation').ValidationError[] {
    return this._getSnapshotContext()._saveValidationErrors ?? []
  }

  get alias() {
    return this._alias
  }

  /**
   * The unresolved conflict between this property's last local edit and a value sync wrote while
   * the edit was pending (ADR 0019): the local edit was kept, and `remoteValue` is what sync wrote.
   * Null when there is none. Cleared by the next edit or `resolveConflict`.
   */
  get conflict(): import('@/outbox/conflicts').PropertyConflict | null {
    return this._getSnapshotContext().conflict ?? null
  }

  /**
   * Settles `conflict`. `'local'` keeps the local edit. `'remote'` drops the local draft, so the
   * synced value shows again (and publish has nothing to send for this property).
   */
  async resolveConflict(choice: 'local' | 'remote'): Promise<void> {
    const { seedLocalId, propertyName } = this._getSnapshotContext()
    if (!seedLocalId || !propertyName) return
    const { appendOutboxOpAndWait, markPropertyConflictsResolved, startItemOutbox, throwItemWriteError } =
      await import('@/outbox')
    if (choice === 'remote') {
      startItemOutbox()
      await appendOutboxOpAndWait({
        seedLocalId,
        propertyName,
        kind: 'delete',
        value: { mode: 'drafts', propertyNames: [propertyName] } satisfies DeleteOp,
      }).catch(throwItemWriteError)
    }
    await markPropertyConflictsResolved(seedLocalId, propertyName)
    this._service.send({ type: 'updateContext', conflict: null })
    if (choice === 'remote') this._service.send({ type: 'rehydrateFromDb' })
  }

  get value() {
    // Use string literal to avoid circular dependency
    const context = this._getSnapshotContext()
    const normalizedDataType = normalizeDataType(this._dataType)
    if (normalizedDataType === 'Image') {
      // For Image: prefer renderValue (blob URL from hydrate/save) for display; fallback to refResolvedValue (filename)
      const rv = context.renderValue
      if (rv && typeof rv === 'string' && rv.startsWith('blob:')) {
        return rv
      }
      return context.refResolvedValue
    }
    const result = context.renderValue || context.propertyValue
    // Read from context via proxy (renderValue or propertyValue)
    return result
  }

  set value(value: any) {
    const context = this._getSnapshotContext()
    const currentValue = context.renderValue || context.propertyValue
    if (currentValue === value) {
      return
    }
    this.setValue(value)
  }

  /**
   * Shows `value` and appends its outbox op before returning (ADR 0019); `await property.save()` to
   * wait until the op applies. Unlike assigning `property.value`, it writes even when `value` is
   * already in context. A value that breaks a rule stays shown with its errors and is not written.
   * A refused or failed write shows the property's current value again: its newest pending op from
   * any tab, else its stored row.
   */
  setValue(value: any): void {
    this._assertLoaded('set')
    // An empty Image, File or Html value has nothing to store: it clears the property
    if ((value == null || (typeof value === 'string' && value.trim() === '')) && this._holdsStorageSeed(this._getSnapshotContext())) {
      this._assign(null, { retract: false })
      return
    }
    this._assign(value)
  }

  /**
   * Clears the value and resolves once it is stored, like `save()` (ADR 0021). A refused or failed
   * clear shows the property's current value again. Publish then attests the property's empty
   * value, so its history shows the removal and reads of earlier Versions keep the old value.
   *
   * @param options.retract - Publish revokes the property's attestations instead, so reads of earlier
   *   Versions stop showing the value too. Revocation is permanent.
   * @throws ClearNotSupportedError for a Boolean or Date property without `retract`: their EAS types
   *   have no empty value.
   * @throws EntityUnloadedError when this instance was unloaded; nothing is written.
   */
  async clear(options: { retract?: boolean } = {}): Promise<void> {
    this._assertLoaded('clear')
    const retract = options.retract === true
    const context = this._getSnapshotContext()
    const dataType = normalizeDataType(this._dataType ?? context.propertyRecordSchema?.dataType)
    if (!retract && (dataType === 'Boolean' || dataType === 'Date')) {
      throw new ClearNotSupportedError(this.propertyName, dataType)
    }
    this._assign(null, { retract })
    await this.save()
  }

  /** An Image, File or Html property, or a Relation to Image: its value is a storage seed. */
  private _holdsStorageSeed(context: PropertyMachineContext): boolean {
    const schema = context.propertyRecordSchema
    const dataType = normalizeDataType(this._dataType ?? schema?.dataType)
    return STORAGE_SEED_TYPES.has(dataType ?? '') || normalizeDataType(schema?.refValueType) === 'Image'
  }

  /**
   * Shows `value` and appends its op. When something it needs isn't there yet (the definition, the
   * seed's local id, the file system, the validation module), it shows the value now and appends
   * once it is; later assignments queue behind it, so ops keep assignment order.
   */
  private _assign(value: any, clear?: { retract: boolean }): void {
    this._assignSeq += 1
    const write: PropertyWrite = { done: Promise.resolve() }
    this._latestWrite = write
    // A new edit settles the property's conflict and the last write's errors (ADR 0019)
    const shown = {
      ...(clear ? CLEARED_CONTEXT : { propertyValue: value, renderValue: value }),
      conflict: null,
      _saveError: undefined,
      _saveValidationErrors: undefined,
      isSaving: true,
    }
    if (!this._writeQueue && this._writable(this._getSnapshotContext())) {
      write.done = this._append(write, value, clear, shown)
      return
    }
    this._service.send({ type: 'updateContext', ...shown })
    const queued = (this._writeQueue ?? Promise.resolve())
      .then(() => this._whenWritable())
      .then(() => this._append(write, value, clear))
      .catch((error: unknown) => this._settleWrite(write, { error }))
    this._writeQueue = queued
    write.done = queued
    void queued.finally(() => {
      if (this._writeQueue === queued) this._writeQueue = undefined
    })
  }

  /** Whether planPropertyWrite can run now. */
  private _writable(context: PropertyMachineContext): boolean {
    if (!context.propertyRecordSchema || !context.seedLocalId || !isValidationLoaded()) return false
    if (propertyWriteKind(context.propertyRecordSchema) === 'set') return true
    try {
      BaseFileManager.getWorkingDir()
      return true
    } catch {
      return false
    }
  }

  /** Waits for what _writable needs; throws when the definition or the seed can't be found. */
  private async _whenWritable(): Promise<void> {
    await whenValidationLoaded()
    let context = this._getSnapshotContext()
    if (!context.propertyRecordSchema) {
      const { modelName, propertyName, modelType, modelFileId, seedLocalId, seedUid, propertyId } = context
      const schema = await resolvePropertyDefinition(modelName ?? '', propertyName ?? '', modelType ?? undefined, {
        modelFileId,
        seedLocalId,
        seedUid,
        propertyId,
      })
      if (!schema) {
        throw new Error(`Failed to save property ${propertyName}: no schema found for ${modelName}.${propertyName}`)
      }
      this._service.send({ type: 'updateContext', propertyRecordSchema: schema })
    }
    context = this._getSnapshotContext()
    if (!context.seedLocalId) {
      // An item known only by its seed uid: its local seed, if it has one
      const { findSeedRow } = await import('@/db/read/findSeedRow')
      const seedLocalId = context.seedUid ? (await findSeedRow({ uid: context.seedUid }))?.localId : undefined
      if (!seedLocalId) throw new Error(`No local seed for the item to save ${context.propertyName} to`)
      this._service.send({ type: 'updateContext', seedLocalId })
    }
    for (let waited = 0; !this._writable(this._getSnapshotContext()); waited += 100) {
      if (waited >= FILE_SYSTEM_WAIT_MS) {
        throw new Error('File system not initialized. Ensure the client has finished loading before saving files.')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  /**
   * Plans the write, shows it and appends its op (with `shown`, the assignment's own fields, in the
   * same update). Resolves when the op settles; never rejects.
   */
  private _append(write: PropertyWrite, value: any, clear?: { retract: boolean }, shown?: object): Promise<void> {
    const context = this._getSnapshotContext()
    let plan: ReturnType<typeof planPropertyWrite>
    try {
      plan = planPropertyWrite(context, value, clear)
    } catch (error) {
      if (shown) this._service.send({ type: 'updateContext', ...shown })
      return this._settleWrite(write, { error })
    }
    if (plan.writeKind === 'invalid') {
      this._service.send({ type: 'updateContext', ...shown, _saveValidationErrors: plan.errors, isSaving: false })
      return Promise.resolve()
    }
    this._service.send({ type: 'updateContext', ...shown, ...plan.display })
    return this._followWrite(write, appendPlannedWrite(context.seedLocalId!, plan), plan)
  }

  /** Waits for an appended op to settle, then shows its row, or the current value if it failed. */
  private async _followWrite(write: PropertyWrite, appended: Promise<string>, plan: PlannedWrite): Promise<void> {
    try {
      const { getOutboxOps, outboxOpResult, startItemOutbox, waitForOutboxOp } = await import('@/outbox')
      startItemOutbox()
      const opId = await appended
      write.opId = opId
      await waitForOutboxOp(opId)
      const [op] = await getOutboxOps([opId])
      // A newer op of the property, from another tab, replaced it
      if (op?.status !== 'applied') return this._settleWrite(write, {})
      const conflict = op.conflict ? (JSON.parse(op.conflict) as import('@/outbox/conflicts').PropertyConflict) : null
      if (conflict) eventEmitter.emit('itemProperty.conflict', conflict)
      return this._settleWrite(write, {
        applied: { ...(await this._appliedContext(plan, outboxOpResult(op))), conflict },
      })
    } catch (error) {
      return this._settleWrite(write, { error })
    }
  }

  /** The context an applied op's row gives: where the value now is, and for a file, its display. */
  private async _appliedContext(plan: PlannedWrite, result: any): Promise<Partial<PropertyMachineContext>> {
    const row = rowContext(result ?? undefined)
    if (plan.writeKind === 'set') {
      const schemaUid = this._getSnapshotContext().schemaUid || result?.schemaUid || undefined
      if (plan.op.value && (plan.op.value as SetPropertyValueOp).clear) return { ...row, schemaUid }
      return { ...row, schemaUid, propertyValue: plan.value as any, renderValue: plan.value }
    }
    if (!result) return row
    if (plan.writeKind === 'itemStorage') {
      // Where the file is, right away: localStoragePath (and so publish uploads) must not wait for
      // the browser's change feed, which Node does not have at all.
      return { ...row, refResolvedValue: result.fileName, localStorageDir: result.localStorageDir }
    }
    // Image and File show a session URL (blob: in browsers, file:// in Node), kept in the context
    // only: stored, it is dead after a reload. Html keeps showing its text.
    const filePath = BaseFileManager.getFilesPath(storageSubdir(plan.writeKind, result.localStorageDir), result.fileName)
    const displayUrl = plan.writeKind === 'html' ? undefined : await BaseFileManager.getContentUrlFromPath(filePath)
    return {
      ...row,
      schemaUid: result.schemaUid || undefined,
      refResolvedValue: result.fileName,
      localStorageDir: result.localStorageDir,
      ...(displayUrl && { renderValue: displayUrl, refResolvedDisplayValue: displayUrl }),
    }
  }

  /**
   * Ends a write. Only the property's latest assignment changes the context: an older one's row is
   * already replaced. A failed write records its error and shows the property's current value: the
   * overlay's next value (a newer pending op, from any tab), else the stored row (decision D2).
   */
  private async _settleWrite(
    write: PropertyWrite,
    outcome: { applied?: Partial<PropertyMachineContext>; error?: unknown },
  ): Promise<void> {
    if (this._latestWrite !== write || isActorStopped(this._service)) return
    if (outcome.error === undefined) {
      this._service.send({ type: 'updateContext', ...outcome.applied, isSaving: false })
      return
    }
    const { throwItemWriteError } = await import('@/outbox')
    let error: unknown = outcome.error
    try {
      throwItemWriteError(outcome.error)
    } catch (mapped) {
      error = mapped
    }
    await this._showCurrentValue().catch((readError) =>
      logger(`[ItemProperty] reading ${this.propertyName} after a failed write`, readError),
    )
    if (this._latestWrite !== write || isActorStopped(this._service)) return
    this._service.send({
      type: 'updateContext',
      _saveError: error instanceof Error ? error : new Error(String(error)),
      isSaving: false,
    })
  }

  /** Shows the property's current row with the overlay (hydrateFromDb), or no value when it has none. */
  private async _showCurrentValue(): Promise<void> {
    const context = this._getSnapshotContext()
    const row = await currentPropertyRow(
      { seedLocalId: context.seedLocalId, seedUid: context.seedUid },
      {
        propertyId: context.propertyId,
        propertyName: context.propertyName,
        modelName: context.modelName,
        modelFileId: context.modelFileId,
        dataType: normalizeDataType(context.propertyRecordSchema?.dataType),
        refValueType: normalizeDataType(context.propertyRecordSchema?.refValueType),
      },
    )
    if (isActorStopped(this._service)) return
    if (!row) {
      this._service.send({ type: 'updateContext', ...CLEARED_CONTEXT, localId: undefined, uid: undefined })
      return
    }
    this._service.send({ type: 'rehydrateFromDb' })
    await waitFor(this._service, (snapshot) => snapshot.value === 'idle' || snapshot.status !== 'active', {
      timeout: DEFAULT_READY_TIMEOUT_MS,
    })
  }

  /**
   * Shows `value` without writing it, for input that writes later (a debounced text field). The
   * next `setValue` or assignment writes; if the change feed reads the property first, it shows
   * the stored value again.
   */
  showValue(value: any): void {
    this._service.send({ type: 'updateContext', propertyValue: value, renderValue: value })
  }

  get published(): boolean {
    return !!this._getSnapshot().context.uid
  }

  subscribe(callback: Partial<Subscriber<any>>) {
    // Subscribe to service instead of BehaviorSubject for reactivity
    return this._service.subscribe((snapshot) => {
      const context = snapshot.context
      const value = context.renderValue || context.propertyValue
      if (callback.next) {
        callback.next(value)
      }
    })
  }

  /**
   * Resolves once the latest assignment's op is applied (ADR 0019). Rejects with its error when it
   * failed (OwnershipError when the item isn't the client's), and with
   * ItemPropertySaveValidationError when the value broke a rule and was not written.
   *
   * It waits until a leader tab applies the op, with no limit by default; outside production a save
   * still waiting after 10 s logs a warning. With `timeoutMs` it rejects with OutboxSaveTimeoutError
   * after that long. The op stays queued and applies later; the error doesn't mean it was dropped.
   */
  async save(options?: { timeoutMs?: number }): Promise<void> {
    this._assertLoaded('save')
    const ctx = this._getSnapshotContext()
    const label = `save ${ctx?.modelName ?? '?'}.${ctx?.propertyName ?? '?'}`
    const { assertItemOwned } = await import('@/helpers/ownership')
    await timed(`${label} ownership`, () =>
      assertItemOwned({
        seedLocalId: ctx?.seedLocalId ?? undefined,
        seedUid: ctx?.seedUid ?? undefined,
      }),
    )
    await timed(`${label} until applied`, async () => {
      // Each await may see a newer assignment start: wait for the latest
      const untilApplied = (async () => {
        for (let write = this._latestWrite; write; ) {
          await write.done
          if (this._latestWrite === write) break
          write = this._latestWrite
        }
      })()
      const name = `${ctx?.modelName ?? '?'}.${ctx?.propertyName ?? '?'}`
      const warning = isProduction()
        ? undefined
        : unrefTimer(() => {
            console.warn(
              `[seed] Saving ${name} has waited ${SLOW_SAVE_WARNING_MS / 1000} s: its write is still queued. ` +
                'No leader tab may be draining the outbox (a frozen or closed tab). ' +
                'Pass save({ timeoutMs }) to stop waiting; the write stays queued either way.',
            )
          }, SLOW_SAVE_WARNING_MS)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const timeoutMs = options?.timeoutMs
        if (timeoutMs === undefined) {
          await untilApplied
          return
        }
        const { OutboxSaveTimeoutError } = await import('@/outbox/outbox')
        await Promise.race([
          untilApplied,
          new Promise<never>((_, reject) => {
            timeout = unrefTimer(() => {
              reject(
                new OutboxSaveTimeoutError(
                  this._latestWrite?.opId,
                  `Saving ${name} timed out after ${timeoutMs} ms. The write is still queued and applies once a leader tab drains the outbox.`,
                ),
              )
            }, timeoutMs)
          }),
        ])
      } finally {
        if (warning) clearTimeout(warning)
        if (timeout) clearTimeout(timeout)
      }
    })
    const { _saveError: saveError, _saveValidationErrors: validationErrors, propertyName } =
      this._getSnapshotContext()
    if (saveError) throw saveError
    if (validationErrors?.length) {
      throw new ItemPropertySaveValidationError(
        `Invalid value for property ${propertyName}: ${validationErrors.map((e) => e.message).join('; ')}`,
        validationErrors,
      )
    }
    if (ctx?.seedLocalId || ctx?.seedUid) {
      eventEmitter.emit('itemProperty.saved', { seedLocalId: ctx.seedLocalId, seedUid: ctx.seedUid })
    }
  }

  /** Throws EntityUnloadedError, naming the property and its item, when this instance was unloaded. */
  private _assertLoaded(action: string): void {
    if (!isEntityTornDown(this)) return
    const { seedLocalId, seedUid, modelName, propertyName } = this._getSnapshotContext()
    throw new EntityUnloadedError(
      `Cannot ${action} ${modelName ?? '?'}.${propertyName ?? '?'} of item ${seedLocalId ?? seedUid ?? '(no id)'}: ` +
        'this ItemProperty instance was unloaded. Look the item or property up again, and hold it while you use it.',
    )
  }

  /**
   * Releases this caller's hold. Once no one holds the property (its item holds it while the item
   * is loaded), it unloads after `SeedConfig.entityCache.unloadGraceMs` unless a hold is taken first.
   */
  unload() {
    releaseEntity(this, ItemProperty.cache)
  }

  /**
   * Destroy the item property: remove from caches, delete its metadata rows (every version of
   * this item's value) from the DB, remove it from the parent Item, and stop the service.
   * Throws OwnershipError if none of the client's addresses own the item.
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const { assertItemOwned } = await import('@/helpers/ownership')
    await assertItemOwned({
      seedLocalId: context.seedLocalId ?? undefined,
      seedUid: context.seedUid ?? undefined,
    })
    // Cached until its rows are gone: removed earlier, a lookup that read a row before the delete
    // applied would build a new instance for it
    await destroyEntity(this, ItemProperty.cache, () => this._destroyRows(context), { leaveCache: 'after' })
  }

  private async _destroyRows(context: PropertyMachineContext): Promise<void> {
    const db = BaseDb.getAppDb()
    const seedLocalId = context.seedLocalId
    const seedUid = context.seedUid
    const propertyName = context.propertyName
    if (!propertyName || (!seedLocalId && !seedUid)) return

    if (db && seedLocalId) {
      // Through the outbox (ADR 0019): after the property's pending edits, which would
      // otherwise write its rows back
      const { appendOutboxOpAndWait, startItemOutbox, throwItemWriteError } = await import('@/outbox')
      startItemOutbox()
      await appendOutboxOpAndWait({
        seedLocalId,
        propertyName,
        kind: 'delete',
        value: { mode: 'property', propertyNames: [propertyName] } satisfies DeleteOp,
      }).catch(throwItemWriteError)
    } else if (db) {
      const seedSchemaMod = await import('../seedSchema')
      const { metadata } = seedSchemaMod
      const drizzleMod = await import('drizzle-orm')
      const { and, eq } = drizzleMod
      const conditions = [eq(metadata.propertyName, propertyName)]
      // Match this item's local rows only. Matching seedUid too would also delete rows of
      // other local copies of the same seed (e.g. duplicate EAS syncs).
      if (seedLocalId) {
        conditions.push(eq(metadata.seedLocalId, seedLocalId))
      } else if (seedUid) {
        conditions.push(eq(metadata.seedUid, seedUid))
      }
      if (conditions.length > 1) {
        await db.delete(metadata).where(and(...conditions))
      }
    }

    const itemMod = await import('../Item/Item')
    const { Item } = itemMod
    const item = Item.peek(seedLocalId || seedUid)
    if (item) {
      item.getService().send({ type: 'removePropertyInstance', propertyName })
    }
  }
}

addCachedPropertyRefresher((propertyFileIds) => ItemProperty.refreshDefinitions(propertyFileIds))
