import { ActorRefFrom, createActor, SnapshotFrom, Subscription, waitFor } from 'xstate'
import { BehaviorSubject, Subscriber } from 'rxjs'
import { Static } from '@sinclair/typebox'
import { IItemProperty } from '@/interfaces/IItemProperty'
import { CreatePropertyInstanceProps, PropertyMachineContext, PropertyType as SchemaPropertyType } from '@/types'
import type { PropertyValueSnapshot } from '@/types/property'
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
import { camelCase, upperFirst } from 'lodash-es'
import { getPropertyData } from '@/db/read/getPropertyData'
import { getItemProperties } from '@/db/read/getItemProperties'
import { BaseDb } from '@/db/Db/BaseDb'
import { queryEntityRows, watchEntityRows } from '@/browser/db/changeFeed'
import {
  BaseFileManager,
  getCorrectId,
  getMetadataPropertyNamesForQuery,
  resolveMetadataRecord,
  resolveStorageNameToSchemaName,
} from '@/helpers'
import { listRelationEasPropertyName, type PropertySchemaEntry } from '@/helpers/metadataPropertyNames'
import { DEFAULT_READY_TIMEOUT_MS, waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import { ActorKeyedState } from '@/helpers/entity/entityState'
import { isActorStopped } from '@/helpers/entity/entityCommon'
import { createSessionObjectUrl, isSessionObjectUrl, revokeSessionObjectUrl } from '@/helpers/sessionObjectUrls'
import {
  clearDestroySubscriptions,
  forceRemoveFromCaches,
  runDestroyLifecycle,
} from '@/helpers/entity/entityDestroy'
import { timed } from '@/helpers/timing'
import { eventEmitter } from '@/eventBus'
// Dynamic import to break circular dependency: schema/index -> ... -> ItemProperty -> schema/index
// Note: TProperty is used as a type, so we can import it separately. ModelPropertyDataTypes is used at runtime.
import type { TProperty } from '@/Schema'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { hasPendingPropertyWrite, propertyWriteKey } from '@/helpers/propertyWriteTickets'
import {
  ModelPropertyDataTypes,
  isDataType,
  normalizeDataType,
  normalizePropertyRecordSchema,
} from '@/helpers/property'

/** Parent Html property `propertyValue` after publish (66-char seed uid). */
const HTML_PROP_SEED_UID_RE = /^0x[a-fA-F0-9]{64}$/

/**
 * Fallback: resolve propertyRecordSchema from schema JSON in DB when Model is not in cache/DB.
 * Used when syncSchemaFromSource failed (e.g. validation error) but schema exists in DB from a previous run.
 */
const resolvePropertyRecordSchemaFromSchemaData = async (
  modelName: string,
  propertyName: string,
  modelType?: string,
  schemaName?: string,
): Promise<SchemaPropertyType | undefined> => {
  try {
    const { loadAllSchemasFromDb } = await import('@/helpers/schema')
    const allSchemas = await loadAllSchemasFromDb()
    const modelNameAlt = modelType ? upperFirst(camelCase(modelType)) : ''
    for (const { schema } of allSchemas) {
      // Model names are only unique per schema: when the owning schema is known, only look there.
      if (schemaName && schema.metadata?.name !== schemaName) continue
      const models = schema.models as Record<string, { properties?: Record<string, any> }> | undefined
      if (!models) continue
      const model = models[modelName] ?? (modelNameAlt ? models[modelNameAlt] : undefined)
      if (!model?.properties) continue
      let prop = model.properties[propertyName]
      if (!prop) {
        const resolvedKey = resolveStorageNameToSchemaName(
          model.properties as Record<string, PropertySchemaEntry>,
          propertyName,
        )
        if (resolvedKey) prop = model.properties[resolvedKey]
      }
      if (!prop) continue
      const p = prop as Record<string, unknown>
      const dataType = (p.dataType ?? p.type) as string
      if (!dataType) continue
      return {
        dataType,
        ref: (p.ref ?? p.model ?? p.refModelName) as string | undefined,
        refValueType: (p.refValueType ?? p.refvaluetype) as string | undefined,
        storageType: p.storageType as string | undefined,
        localStorageDir: p.localStorageDir as string | undefined,
        filenameSuffix: p.filenameSuffix as string | undefined,
        required: p.required as boolean | undefined,
      } as SchemaPropertyType
    }
  } catch {
    // Ignore - fallback failed
  }
  return undefined
}

/**
 * Resolve propertyRecordSchema from in-memory Model (Fix 6: enables value persistence when useItemProperty path doesn't go through loadOrCreateItem).
 * Tries getByName(pascalCase) first; if that fails (e.g. "New model" vs "NewModel"), falls back to findByModelType(modelType).
 */
const resolvePropertyRecordSchemaFromModel = async (
  modelName: string,
  propertyName: string,
  modelType?: string,
  /** Hints identifying the owning item's model (model names are only unique per schema). */
  hints: { modelFileId?: string | null; seedLocalId?: string | null; seedUid?: string | null; propertyId?: number | null } = {},
): Promise<SchemaPropertyType | undefined> => {
  if (!modelName && !modelType) {
    return undefined
  }
  try {
    const { Model } = await import('@/Model/Model')
    const { modelPropertiesToObject } = await import('@/helpers/model')
    const { resolveItemModelFileId } = await import('@/db/read/resolveModelRecord')
    const modelFileId = await resolveItemModelFileId(hints)
    let model = modelFileId
      ? await Model.resolveAsync(modelName || modelTypeToModelName(modelType ?? ''), { modelFileId })
      : undefined
    if (!model?.properties?.length && modelName) {
      model = Model.peekByName(modelName)
    }
    if (!model?.properties?.length && modelType) {
      model = Model.findByModelType(modelType)
    }
    // Fallback: load from DB when not in cache (fixes external app persistence when Model not yet loaded)
    if (!model?.properties?.length && modelName) {
      model = await Model.getByNameAsync(modelName, undefined, { hold: false })
    }
    if (!model?.properties?.length && modelType) {
      model = await Model.getByNameAsync(modelTypeToModelName(modelType), undefined, { hold: false })
    }
    if (!model?.properties?.length) {
      // Fallback: resolve from schema JSON when Model not in cache/DB (e.g. PermaPress sync failed but schema in DB)
      const schemaProp = await resolvePropertyRecordSchemaFromSchemaData(
        modelName,
        propertyName,
        modelType,
        model?.schemaName,
      )
      if (schemaProp) {
        // Schema JSON uses file shape ({ type: 'Html' }); callers read dataType.
        return normalizePropertyRecordSchema(schemaProp)
      }
      return undefined
    }
    const schemas = modelPropertiesToObject(model.properties)
    let schemaKey = propertyName
    if (!schemas[schemaKey]) {
      const resolved = resolveStorageNameToSchemaName(schemas, propertyName)
      if (resolved) schemaKey = resolved
    }
    const schema = schemas[schemaKey]
    return schema as SchemaPropertyType | undefined
  } catch {
    return undefined
  }
}

/** Convert modelType (snake_case from DB) to Model name (PascalCase). startCase adds spaces ("Test Post"); Model names are "TestPost". */
const modelTypeToModelName = (modelType: string): string =>
  modelType ? upperFirst(camelCase(modelType)) : ''

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
      // Restored if the pending save is refused.
      context._valueBeforeSave?.renderValue,
      context._valueBeforeSave?.propertyValue,
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

// Mutable state per ItemProperty instance
const itemPropertyInstanceState = new ActorKeyedState<ItemProperty<any>, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance updates
  schemaLiveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for properties table (schema changes)
}>()

/**
 * Each cached instance's entry in `ItemProperty.instanceCache`, keyed by its actor. Every key the
 * instance is cached under shares this one entry, so `retain` and the constructor's re-keying find
 * it without scanning the cache.
 */
const cacheEntries = new WeakMap<object, { instance: ItemProperty<any>; refCount: number }>()

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
   * @internal false for SDK code that hands the instance to an owner that takes its own hold (an
   * Item's property map): no hold is taken, and a new instance is cached with none.
   */
  hold?: false
}

export class ItemProperty<PropertyType> implements IItemProperty<PropertyType> {
  protected static instanceCache: Map<
    string,
    { instance: ItemProperty<any>; refCount: number }
  > = new Map()
  protected readonly _service: ItemPropertyService
  protected _subject: BehaviorSubject<any>
  protected readonly _isRelation: boolean = false
  protected readonly _isList: boolean = false
  protected readonly _alias: string | undefined
  protected _subscription: Subscription
  protected _dataType: string | undefined
  /** Set while the value setter resolves a missing schema before sending `save`; save() awaits it. */
  protected _pendingSchemaSave: Promise<boolean> | undefined
  /** What showed before the first `showValue` since the last save; that save rolls back to it. */
  protected _unsavedBefore: PropertyValueSnapshot | undefined
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
      isDbReady: false,
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

        if (context.seedLocalId && context.propertyName) {
          const cacheKey = ItemProperty.cacheKey(
            context.seedLocalId,
            context.propertyName,
          )
          // The context's ids or name can change after create (a seed uid arrives, a List of relation
          // moves to its storage name): add the new key to this instance's entry. Never a new entry
          // or count, and nothing once the instance was unloaded (this runs after an await).
          const entry = cacheEntries.get(this._service)
          if (
            entry &&
            !ItemProperty.instanceCache.has(cacheKey) &&
            this._service.getSnapshot().status === 'active'
          ) {
            ItemProperty.instanceCache.set(cacheKey, entry)
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

        if (
          (isImage || isFile || isItemStorage || isHtml) &&
          context.refResolvedValue
        ) {
          const dir = context.localStorageDir?.replace(/^\//, '') || (isHtml ? 'html' : 'images')
          let filePath = BaseFileManager.getFilesPath(dir, context.refResolvedValue)
          try {
            // An ItemStorage value whose op is pending is in its staged file (ADR 0019)
            if (isItemStorage) {
              const { getPendingPropertyRow } = await import('@/outbox/pendingValues')
              const staged = (await getPendingPropertyRow(context.seedLocalId, context.propertyName))?.stagedPath
              if (staged && (await BaseFileManager.pathExists(staged))) filePath = staged
            }
            let exists = await BaseFileManager.pathExists(filePath)
            if (!exists && isHtml) {
              await BaseFileManager.waitForFileWithContent(filePath, 100, 5000).catch(() => {})
              exists = await BaseFileManager.pathExists(filePath)
            }
            if (exists && (isItemStorage || isHtml)) {
              renderValue = await BaseFileManager.readFileAsString(filePath,)
            }
            if (exists && isImage) {
              if (context.refResolvedDisplayValue) {
                renderValue = context.refResolvedDisplayValue
              } 
              if (!context.refResolvedDisplayValue) {
                renderValue = mintedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)
              }
            }
            if (exists && isFile) {
              // A File's value is its content URL (a blob URL in browsers, file:// in Node), as saveFile
              // and hydrateFromDb set it. Reading the text here made the value change from the URL to
              // the file's contents a moment after every save or load.
              renderValue = context.refResolvedDisplayValue
              if (!renderValue) {
                renderValue = mintedDisplayValue = await BaseFileManager.getContentUrlFromPath(filePath)
              }
            }
            if (!exists) {
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

    // Initialize instance state in WeakMap
    itemPropertyInstanceState.set(this, {
      liveQuerySubscription: null,
      schemaLiveQuerySubscription: null,
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
        const propertyNames = getMetadataPropertyNamesForQuery(
          propertyName,
          normalizedDataType,
          normalizedRefValueType
        )

        // File and Image display values are session URLs minted from the file on disk; the column holds
        // nothing useful for them (older versions stored blob: URLs that die on reload). Keep the minted
        // one unless the row now points at a different file, then clear it so the next render mints anew.
        // A kept URL is also the renderValue: the row's propertyValue (the storage seed id) showed for a
        // moment on every write to the metadata table, then the subscriber put the URL back.
        const displayValueFromRow = (row: { refResolvedValue: string | null; refResolvedDisplayValue: string | null }) => {
          const { context } = this._service.getSnapshot()
          const isSessionUrlType =
            normalizedDataType === 'Image' ||
            normalizedDataType === 'File' ||
            normalizedRefValueType === 'Image' ||
            context.refSeedType === 'image' ||
            context.refSeedType === 'file'
          if (!isSessionUrlType) {
            return { refResolvedDisplayValue: row.refResolvedDisplayValue || undefined }
          }
          if ((row.refResolvedValue || undefined) === context.refResolvedValue) {
            return context.refResolvedDisplayValue ? { renderValue: context.refResolvedDisplayValue } : {}
          }
          return { refResolvedDisplayValue: undefined }
        }

        const drizzleMod = await import('drizzle-orm')
        const { eq, and, or } = drizzleMod
        const metadataLatestMod = await import('../db/read/subqueries/metadataLatest')
        const { getMetadataLatest } = metadataLatestMod
        
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('[ItemProperty._setupLiveQuerySubscription] Database not available')
          return
        }

        // Query initial metadata using getMetadataLatest subquery pattern
        // For File/Image/Relation, also check the Id variant (e.g. "textId") since metadata is stored with that
        const metadataLatest = getMetadataLatest({ seedLocalId, seedUid })
        const propertyNameWhere =
          propertyNames.length > 1
            ? or(...propertyNames.map((n) => eq(metadataLatest.propertyName, n)))
            : eq(metadataLatest.propertyName, propertyNames[0])
        // In the browser the feed watch below reads the same row at once, so only Node (no change
        // feed) reads it here.
        const initialMetadata = isBrowser
          ? []
          : await db
              .with(metadataLatest)
              .select()
              .from(metadataLatest)
              .where(and(propertyNameWhere, eq(metadataLatest.rowNum, 1)))
              .limit(15)

        if (initialMetadata.length > 0) {
          const normalizedDataType = normalizeDataType(propertyRecordSchema?.dataType)
          const normalizedRefValueType = normalizeDataType(propertyRecordSchema?.refValueType)
          const metaRow = resolveMetadataRecord(
            initialMetadata as (import('@/seedSchema').MetadataType & {
              refResolvedValue?: string | null
              refSeedType?: string
            })[],
            propertyName,
            normalizedDataType,
            normalizedRefValueType,
          )
          logger(`[ItemProperty._setupLiveQuerySubscription] Initial query returned metadata record`)
          
          // Update context with initial metadata
          this._service.send({
            type: 'updateContext',
            propertyValue: metaRow.propertyValue,
            renderValue: metaRow.propertyValue,
            localId: metaRow.localId || undefined,
            uid: metaRow.uid || undefined,
            versionLocalId: metaRow.versionLocalId || undefined,
            versionUid: metaRow.versionUid || undefined,
            schemaUid: metaRow.schemaUid || undefined,
            refResolvedValue: metaRow.refResolvedValue || undefined,
            ...displayValueFromRow(metaRow),
            localStorageDir: metaRow.localStorageDir || undefined,
          })
        }

        // Only watch for changes in the browser (the change feed is browser-only)
        if (isBrowser) {
          // Use proper SQL parameter binding - ensure values are strings, not objects
          const resolvedSeedUid = seedUid || null
          const resolvedSeedLocalId = seedLocalId || null
          
          // For File/Image/Relation, query both propertyName and propertyNameId (metadata stores with Id suffix)
          // Build query with primitive params only (SQLocal bind rejects SQL fragment objects)
          // ORDER BY spells out METADATA_LATEST_FIRST_ORDER_SQL (compareMetadataRowsLatestFirst) for the same reason
          const [p0, p1, p2] = propertyNames
          type MetadataRow = { localId: string | null; uid: string | null; propertyName: string; propertyValue: string; versionLocalId: string | null; versionUid: string | null; schemaUid: string | null; refResolvedValue: string | null; refResolvedDisplayValue: string | null; localStorageDir: string | null }
          const metadataQuery = (sql: any) => {
            if (resolvedSeedUid) {
              if (propertyNames.length === 1) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                         ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                  FROM metadata
                  WHERE seed_uid = ${resolvedSeedUid} AND property_name = ${p0} AND property_name IS NOT NULL
                  ORDER BY (revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC LIMIT 1
                `
              }
              if (propertyNames.length === 2) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                         ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                  FROM metadata
                  WHERE seed_uid = ${resolvedSeedUid} AND (property_name = ${p0} OR property_name = ${p1}) AND property_name IS NOT NULL
                  ORDER BY (revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC LIMIT 1
                `
              }
              if (propertyNames.length >= 3) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                         ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                  FROM metadata
                  WHERE seed_uid = ${resolvedSeedUid} AND (property_name = ${p0} OR property_name = ${p1} OR property_name = ${p2}) AND property_name IS NOT NULL
                  ORDER BY (revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC LIMIT 1
                `
              }
            } else if (resolvedSeedLocalId) {
              if (propertyNames.length === 1) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                         ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                  FROM metadata
                  WHERE seed_local_id = ${resolvedSeedLocalId} AND property_name = ${p0} AND property_name IS NOT NULL
                  ORDER BY (revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC LIMIT 1
                `
              }
              if (propertyNames.length === 2) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                         ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                  FROM metadata
                  WHERE seed_local_id = ${resolvedSeedLocalId} AND (property_name = ${p0} OR property_name = ${p1}) AND property_name IS NOT NULL
                  ORDER BY (revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC LIMIT 1
                `
              }
              if (propertyNames.length >= 3) {
                return sql`
                  SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                         version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                         ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                  FROM metadata
                  WHERE seed_local_id = ${resolvedSeedLocalId} AND (property_name = ${p0} OR property_name = ${p1} OR property_name = ${p2}) AND property_name IS NOT NULL
                  ORDER BY (revoked_at IS NOT NULL), COALESCE(attestation_created_at, created_at) DESC, local_id DESC LIMIT 1
                `
              }
            }
            return sql`SELECT 1 WHERE 1 = 0`
          }

          const instanceState = itemPropertyInstanceState.get(this)
          if (!instanceState) {
            logger('[ItemProperty._setupLiveQuerySubscription] Instance state not found')
            return
          }

          // Unloaded or destroyed while setup awaited: watching now would leak the watch.
          if (isActorStopped(this._service)) return

          // Re-read on each change to this property's metadata rows (ADR 0020)
          const subscription = watchEntityRows<MetadataRow[]>(
            {
              seedLocalId: resolvedSeedLocalId,
              seedUid: resolvedSeedUid,
              tables: ['metadata'],
              propertyNames,
            },
            () => queryEntityRows<MetadataRow>(metadataQuery),
            (metadataRows) => {
              if (metadataRows.length === 0) return
              
              const metaRow = metadataRows[0]
              logger(`[ItemProperty._setupLiveQuerySubscription] Metadata updated in database for propertyName: ${propertyName}`)

              // While this property has a save pending, the row is older than the value in memory
              // (the user may still be typing): showing it would drop keystrokes, and another tab's
              // write would replace the value being typed. The save sets the context itself.
              const { context } = this._service.getSnapshot()
              if (
                context.isSaving ||
                hasPendingPropertyWrite(
                  propertyWriteKey(context.seedLocalId ?? context.seedUid, context.propertyName),
                )
              ) {
                return
              }

              // Update context with metadata changes
              this._service.send({
                type: 'updateContext',
                propertyValue: metaRow.propertyValue,
                renderValue: metaRow.propertyValue,
                localId: metaRow.localId || undefined,
                uid: metaRow.uid || undefined,
                versionLocalId: metaRow.versionLocalId || undefined,
                versionUid: metaRow.versionUid || undefined,
                schemaUid: metaRow.schemaUid || undefined,
                refResolvedValue: metaRow.refResolvedValue || undefined,
                ...displayValueFromRow(metaRow),
                localStorageDir: metaRow.localStorageDir || undefined,
              })
            },
            {
              immediate: true,
              onError: (error) => logger(`[ItemProperty._setupLiveQuerySubscription] Metadata read error: ${error}`),
            },
          )

          instanceState.liveQuerySubscription = subscription
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

        const schema$ = BaseDb.liveQuery<{
          dataType: string
          refValueType: string | null
          refModelName: string | null
          storageType: string | null
          localStorageDir: string | null
          filenameSuffix: string | null
        }>(
          (sql: any) => sql`
            SELECT p.data_type as dataType, p.ref_value_type as refValueType, ref.name as refModelName,
              p.storage_type as storageType, p.local_storage_dir as localStorageDir,
              p.filename_suffix as filenameSuffix
            FROM properties p
            INNER JOIN models m ON p.model_id = m.id
            LEFT JOIN models ref ON p.ref_model_id = ref.id
            WHERE p.name = ${propertyName}
              AND (CASE WHEN ${modelFileId ?? null} IS NOT NULL
                THEN m.schema_file_id = ${modelFileId ?? null}
                ELSE m.name = ${modelName} END)
            ORDER BY m.id DESC
            LIMIT 1
          `
        )

        const instanceState = itemPropertyInstanceState.get(this)
        if (!instanceState) {
          logger('[ItemProperty._setupPropertySchemaLiveQuery] Instance state not found')
          return
        }

        // Unloaded or destroyed while setup awaited: subscribing now would leak the query.
        if (isActorStopped(this._service)) return

        const subscription = schema$.subscribe({
          next: (rows) => {
            if (rows.length === 0) return

            const row = rows[0]
            const propertyRecordSchema = {
              dataType: row.dataType,
              ref: row.refModelName || undefined,
              refValueType: row.refValueType || undefined,
              storageType: row.storageType || undefined,
              localStorageDir: row.localStorageDir || undefined,
              filenameSuffix: row.filenameSuffix || undefined,
            }

            logger(`[ItemProperty._setupPropertySchemaLiveQuery] Schema updated for ${propertyName}: dataType=${row.dataType}`)

            this._service.send({
              type: 'updateContext',
              propertyRecordSchema,
            })

            // Update instance fields to match new schema (mirror constructor logic)
            this._dataType = normalizeDataType(propertyRecordSchema.dataType)
            if (isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.Relation)) {
              ;(this as any)._isRelation = true
            } else {
              ;(this as any)._isRelation = false
            }
            if (isDataType(propertyRecordSchema.dataType, ModelPropertyDataTypes.List)) {
              ;(this as any)._isList = true
              ;(this as any)._isRelation = !!(propertyRecordSchema.ref)
            } else {
              ;(this as any)._isList = false
            }
          },
          error: (error) => {
            logger(`[ItemProperty._setupPropertySchemaLiveQuery] LiveQuery error: ${error}`)
          },
        })

        instanceState.schemaLiveQuerySubscription = subscription
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
    // Try both keys so we hit cache whether instance was created by find(seedLocalId) or from getItemProperties (may have only seedUid in row)
    const cacheKey = keyByLocal || keyByUid!
    const lookupKey = (keyByLocal && this.instanceCache.has(keyByLocal))
      ? keyByLocal
      : (keyByUid && this.instanceCache.has(keyByUid))
        ? keyByUid
        : null
    if (lookupKey) {
      // One entry under both keys: one hold count for the instance
      const entry = this.instanceCache.get(lookupKey)!
      entry.refCount += holds
      const { instance } = entry
      const otherKey = lookupKey === keyByLocal ? keyByUid : keyByLocal
      if (otherKey) this.instanceCache.set(otherKey, entry)
      // On cache hit, sync refResolvedValue/refResolvedDisplayValue/localStorageDir/refSeedType when incoming has them
      // but cached instance doesn't (e.g. Item constructor created from schema first, then loadOrCreateItem
      // has metadata with refResolvedValue - we must not lose display data).
      const ctx = (instance as ItemProperty<any>)._getSnapshotContext()
      const incomingSchema = normalizePropertyRecordSchema(props.propertyRecordSchema)
      if (incomingSchema && !ctx.propertyRecordSchema) {
        ;(instance as ItemProperty<any>)._dataType = normalizeDataType(incomingSchema.dataType)
        ;(instance as any)._isRelation = isDataType(incomingSchema.dataType, ModelPropertyDataTypes.Relation)
        ;(instance as any)._isList = isDataType(incomingSchema.dataType, ModelPropertyDataTypes.List)
        ;(instance as ItemProperty<any>)._service.send({
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
          (instance as ItemProperty<any>)._service.send({ type: 'updateContext', ...updates })
        }
      }
      // After wipe/reconnect, cached actors can stay idle with stale renderValue while DB + Arweave
      // paths would hydrate. Re-run DB hydration without clobbering propertyValue.
      const svc = (instance as ItemProperty<any>)._service
      const snap = svc.getSnapshot() as { status?: string; value?: unknown }
      if (snap.status === 'active' && snap.value === 'idle') {
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
      // On cache hit, do not sync propertyValue: refetches can race with in-memory updates (e.g. save()).
      if (!waitForReady) return instance
      return waitForEntityIdle(instance, { timeout: readyTimeout }).then(
        () => instance,
      )
    }
    if (seedLocalId && propertyName) {
      if (!this.instanceCache.has(cacheKey)) {
        const newInstance = new ItemProperty(props)
        
        // Wrap instance in Proxy for reactive property access
        const proxiedInstance = ItemProperty.wrapInProxy(newInstance)
        
        const entry = { instance: proxiedInstance, refCount: holds }
        cacheEntries.set(newInstance._service, entry)
        this.instanceCache.set(cacheKey, entry)
        if (keyByUid && keyByUid !== cacheKey) this.instanceCache.set(keyByUid, entry)
        if (!waitForReady) return proxiedInstance
        return waitForEntityIdle(proxiedInstance, { timeout: readyTimeout }).then(
          () => proxiedInstance,
        )
      }
    }
    if (seedUid && propertyName) {
      if (!this.instanceCache.has(cacheKey)) {
        const newInstance = new ItemProperty(props)
        
        // Wrap instance in Proxy for reactive property access
        const proxiedInstance = ItemProperty.wrapInProxy(newInstance)
        
        const entry = { instance: proxiedInstance, refCount: holds }
        cacheEntries.set(newInstance._service, entry)
        this.instanceCache.set(cacheKey, entry)
        if (keyByLocal && keyByLocal !== cacheKey) this.instanceCache.set(keyByLocal, entry)
        if (!waitForReady) return proxiedInstance
        return waitForEntityIdle(proxiedInstance, { timeout: readyTimeout }).then(
          () => proxiedInstance,
        )
      }
    }
    const newInstance = new ItemProperty(props)
    
    // Wrap instance in Proxy for reactive property access
    const result = ItemProperty.wrapInProxy(newInstance)
    if (!waitForReady) return result
    return waitForEntityIdle(result, { timeout: readyTimeout }).then(
      () => result,
    )
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
   * The cached ItemProperty when it can be read right now (idle, not saving), the state
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
      const instance = this.instanceCache.get(key)?.instance
      if (!instance) continue
      const snap = instance.getService().getSnapshot() as {
        status?: string
        value?: unknown
        context?: { isSaving?: boolean }
      }
      if (snap.status !== 'active' || snap.value !== 'idle' || snap.context?.isSaving) return undefined
      return instance
    }
    return undefined
  }

  /** Takes a hold on the instance it returns: release it with `unload()`. */
  static async find({
    propertyName,
    seedLocalId,
    seedUid,
    modelName: modelNameOption,
    waitForReady = true,
    readyTimeout = DEFAULT_READY_TIMEOUT_MS,
    hold,
  }: ItemPropertyFindProps & {
    waitForReady?: boolean
    readyTimeout?: number
  } & ItemPropertyHoldOption): Promise<ItemProperty<any> | undefined> {
    if ((!seedLocalId && !seedUid) || !propertyName) {
      return undefined
    }
    
    const cacheKeyId = seedUid || seedLocalId
    const cacheKey = ItemProperty.cacheKey(cacheKeyId!, propertyName)
    let foundProperty: ItemProperty<any> | undefined
    
    // Check cache first. Mutate the entry: it may also be stored under the item's other id.
    const cachedEntry = this.instanceCache.get(cacheKey)
    if (cachedEntry) {
      if (hold !== false) cachedEntry.refCount += 1
      foundProperty = cachedEntry.instance as ItemProperty<any>
    } else {
      // Query database
      const propertyData = await getPropertyData({
        propertyName,
        seedLocalId,
        seedUid,
        modelName: modelNameOption,
      })
      if (!propertyData) {
        return undefined
      }
      // Ensure modelName for constructor: metadata may have modelType only, or neither (e.g. when Item passes it)
      // Use modelTypeToModelName: modelType is snake_case ("test_post"); Model names are PascalCase ("TestPost")
      const data = propertyData as { modelName?: string; modelType?: string }
      const modelName =
        data.modelName ??
        ((data.modelType ? modelTypeToModelName(data.modelType) : '') || modelNameOption || '')
      // Fix 6: resolve propertyRecordSchema from Model so value setter can persist (useItemProperty path)
      // Pass modelType for fallback: "New model" -> "new_model" can't be reversed to exact name; findByModelType handles it
      const propertyRecordSchema = await resolvePropertyRecordSchemaFromModel(
        modelName,
        propertyName,
        data.modelType,
        {
          seedLocalId: (propertyData as { seedLocalId?: string }).seedLocalId ?? seedLocalId,
          seedUid: (propertyData as { seedUid?: string }).seedUid ?? seedUid,
          propertyId: (propertyData as { propertyId?: number }).propertyId,
        },
      )
      foundProperty = ItemProperty.create(
        { ...propertyData, modelName, propertyRecordSchema },
        { waitForReady: false, hold },
      )
    }

    if (!foundProperty) {
      return undefined
    }

    if (waitForReady) {
      await waitForEntityIdle(foundProperty, { timeout: readyTimeout })
    }

    return foundProperty
  }

  /**
   * Get all ItemProperty instances for an item.
   * Loads property data via getItemProperties, creates instances via create, optionally waits for idle.
   * Takes a hold on each instance, as `create` does.
   */
  static async all(
    params: { seedLocalId?: string; seedUid?: string },
    options?: { waitForReady?: boolean; readyTimeout?: number } & ItemPropertyHoldOption,
  ): Promise<ItemProperty<any>[]> {
    const { waitForReady = false, readyTimeout = DEFAULT_READY_TIMEOUT_MS, hold } = options ?? {}
    const { seedLocalId, seedUid } = params
    if (!seedLocalId && !seedUid) {
      return []
    }

    const propertiesData = await getItemProperties({ seedLocalId, seedUid })
    const instances: ItemProperty<any>[] = []
    const seenNormalized = new Set<string>()

    const { resolveItemModelFileId } = await import('../db/read/resolveModelRecord')
    const itemModelFileId = await resolveItemModelFileId({ seedLocalId, seedUid })
    for (const data of propertiesData) {
      const d = data as {
        modelName?: string
        modelType?: string
        propertyName?: string
        refSeedType?: string
        propertyId?: number
      }
      const modelName =
        d.modelName ?? (d.modelType ? modelTypeToModelName(d.modelType) : '') ?? ''
      const modelFileId =
        itemModelFileId ?? (await resolveItemModelFileId({ propertyId: d.propertyId }))
      // Normalize Id-suffix for File/Image/Relation: metadata stores "textId" but schema defines "text"
      let propertyName = d.propertyName ?? ''
      const baseName = propertyName.endsWith('Id') ? propertyName.slice(0, -2) : undefined
      const refSeedType = d.refSeedType as string | undefined
      const isRefType = refSeedType && ['file', 'image', 'relation', 'html'].includes(refSeedType)
      if (baseName && isRefType) {
        propertyName = baseName
      } else if (baseName) {
        try {
          const { Model } = await import('../Model/Model')
          const { modelPropertiesToObject } = await import('../helpers/model')
          const model = await Model.resolveAsync(modelName, { modelFileId })
          if (model?.properties) {
            const schemas = modelPropertiesToObject(model.properties)
            if (schemas[baseName]) propertyName = baseName
          }
        } catch {
          // Model not loaded, keep original
        }
      }
      if (modelName && propertyName) {
        try {
          const { Model } = await import('../Model/Model')
          const { modelPropertiesToObject } = await import('../helpers/model')
          const model = await Model.resolveAsync(modelName, { modelFileId })
          if (model?.properties?.length) {
            const schemas = modelPropertiesToObject(model.properties)
            const listKey = resolveStorageNameToSchemaName(schemas, propertyName)
            if (listKey) propertyName = listKey
          }
        } catch {
          // Model not loaded, keep original
        }
      }
      if (seenNormalized.has(propertyName)) continue
      seenNormalized.add(propertyName)
      // Fix 6: resolve propertyRecordSchema from Model so value setter can persist
      const propertyRecordSchema = propertyName
        ? await resolvePropertyRecordSchemaFromModel(modelName, propertyName, d.modelType, { modelFileId })
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
      await Promise.all(
        instances.map((p) =>
          waitForEntityIdle(p as Parameters<typeof waitForEntityIdle>[0], {
            timeout: readyTimeout,
          }),
        ),
      )
    }

    return instances
  }

  find = ItemProperty.find

  /**
   * @internal Takes one more hold on a cached, running instance, released with `unload()`. False
   * (and no hold) when the instance isn't cached or was stopped.
   */
  static retain(instance: IItemProperty<any>): boolean {
    const service = instance.getService()
    const entry = cacheEntries.get(service)
    if (!entry || service.getSnapshot().status !== 'active') return false
    entry.refCount += 1
    return true
  }

  /**
   * Stops an item's cached properties that nobody holds. Internal lookups cache a property without
   * a hold for the item to take; one that finished after the item stopped (a liveQuery handler's
   * find, say) never got that hold and would otherwise keep running. Called when the item stops.
   */
  static unloadUnheldForItem(seedIds: Array<string | null | undefined>): void {
    const prefixes = seedIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => this.cacheKey(id, ''))
    if (prefixes.length === 0) return
    const unheld = new Set<ItemProperty<any>>()
    for (const [key, entry] of this.instanceCache) {
      if (entry.refCount <= 0 && prefixes.some((prefix) => key.startsWith(prefix))) unheld.add(entry.instance)
    }
    for (const instance of unheld) {
      try {
        instance.unload()
      } catch {
        // Already stopped
      }
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
    const { uid, localId } = getCorrectId(seedLocalIdOrUid)
    const prefix = `Item_${uid || localId}_`
    const dropped = new Set<{ instance: ItemProperty<any>; refCount: number }>()
    for (const [key, entry] of this.instanceCache) {
      if (key.startsWith(prefix)) dropped.add(entry)
    }
    for (const [key, entry] of Array.from(this.instanceCache)) {
      if (dropped.has(entry)) this.instanceCache.delete(key)
    }
    for (const entry of dropped) {
      const service = entry.instance.getService()
      if (cacheEntries.get(service) === entry) cacheEntries.delete(service)
    }
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

  /** DB / EAS / metadata column name (e.g. authorIdentityIds). Use for storage; prefer `propertyName` for public API. */
  get storagePropertyName(): string {
    return this._getSnapshotContext().propertyName || ''
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

  get status() {
    return this._getSnapshot().value
  }

  /** Validation errors from last failed save (enum, pattern, minLength, maxLength). Cleared when the next save starts. */
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
        value: { mode: 'drafts', propertyNames: [propertyName] } satisfies import('@/outbox').DeleteOp,
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
   * Shows `value` at once and saves it; `await property.save()` to wait for the result. Unlike
   * assigning `property.value`, it saves even when `value` is already in context.
   *
   * @param options.before - The values to restore if the save is refused or fails. Defaults to what
   *   showed before the first `showValue` since the last save, else the current context.
   */
  setValue(value: any, options: { before?: PropertyValueSnapshot } = {}): void {
    const context = this._getSnapshotContext()
    // Restored if the save is refused (item not owned), breaks a validation rule, or fails.
    const before = options.before ??
      this._unsavedBefore ?? { propertyValue: context.propertyValue, renderValue: context.renderValue }
    this._unsavedBefore = undefined
    // Update context immediately so UI shows the value before save completes. A new edit settles
    // the property's conflict (ADR 0019).
    this._service.send({
      type: 'updateContext',
      propertyValue: value,
      renderValue: value,
      conflict: null,
    })

    // If no propertyRecordSchema, try to resolve from Model before persisting (fixes external app persistence)
    if (!context.propertyRecordSchema) {
      const { modelName, propertyName, modelType, modelFileId, seedLocalId, seedUid, propertyId } = context
      const pending = resolvePropertyRecordSchemaFromModel(modelName ?? '', propertyName ?? '', modelType ?? undefined, {
        modelFileId,
        seedLocalId,
        seedUid,
        propertyId,
      }).then(
        (schema) => {
          if (!schema) return false
          this._service.send({ type: 'updateContext', propertyRecordSchema: schema })
          this._service.send({ type: 'save', newValue: value, before })
          return true
        },
        () => false,
      )
      this._pendingSchemaSave = pending
      void pending.finally(() => {
        if (this._pendingSchemaSave === pending) this._pendingSchemaSave = undefined
      })
    } else {
      this._service.send({
        type: 'save',
        newValue: value,
        before,
      })
    }
  }

  /**
   * Shows `value` without saving it, for input that saves later (a debounced text field). The next
   * `setValue` or assignment saves, and if that save is refused or fails, the property goes back to
   * what showed before the first `showValue`.
   */
  showValue(value: any): void {
    if (!this._unsavedBefore) {
      const context = this._getSnapshotContext()
      this._unsavedBefore = { propertyValue: context.propertyValue, renderValue: context.renderValue }
    }
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

  async save(): Promise<void> {
    const ctx = this._getSnapshotContext()
    const label = `save ${ctx?.modelName ?? '?'}.${ctx?.propertyName ?? '?'}`
    const { assertItemOwned } = await import('@/helpers/ownership')
    await timed(`${label} ownership`, () =>
      assertItemOwned({
        seedLocalId: ctx?.seedLocalId ?? undefined,
        seedUid: ctx?.seedUid ?? undefined,
      }),
    )
    // Without this, save() would see `idle` before the deferred `save` event and resolve unsaved.
    if (this._pendingSchemaSave && !(await this._pendingSchemaSave)) {
      throw new Error(
        `Failed to save property ${ctx?.propertyName}: no schema found for ${ctx?.modelName}.${ctx?.propertyName}`,
      )
    }
    const settled = await timed(`${label} until idle`, () =>
      waitFor(this._service, (snapshot) => !snapshot.context.isSaving && snapshot.value === 'idle', {
        timeout: 10_000,
      }),
    )
    const { _saveError: saveError, _saveValidationErrors: validationErrors, propertyName } =
      settled.context
    if (saveError) throw saveError
    if (validationErrors?.length) {
      throw new ItemPropertySaveValidationError(
        `Invalid value for property ${propertyName}: ${validationErrors.map((e) => e.message).join('; ')}`,
        validationErrors,
      )
    }
    const canonicalId = ctx?.seedLocalId ?? ctx?.seedUid
    if (canonicalId) {
      eventEmitter.emit('itemProperty.saved', { seedLocalId: ctx.seedLocalId, seedUid: ctx.seedUid })
      if (typeof window !== 'undefined' && window.__SEED_INVALIDATE_ITEM_PROPERTIES__) {
        window.__SEED_INVALIDATE_ITEM_PROPERTIES__(canonicalId)
      }
    }
    // return new Promise((resolve) => {
    //   const saveSub = this._service.subscribe((snapshot) => {
    //     if (!snapshot.context.isSaving) {
    //       saveSub.unsubscribe()
    //       resolve()
    //     }
    //   })
    // })
  }

  /**
   * Every cache key holding this instance: its item's local id and seed uid, and the name it had
   * before a rename (List of relation). They share one entry.
   */
  private _cacheKeys(): string[] {
    const keys: string[] = []
    for (const [key, entry] of ItemProperty.instanceCache) {
      if (entry.instance.getService() === this._service) keys.push(key)
    }
    return keys
  }

  unload() {
    try {
      const cacheKeys = this._cacheKeys()
      unloadEntity(this, {
        getCacheKeys: () => cacheKeys,
        caches: [ItemProperty.instanceCache],
        instanceState: itemPropertyInstanceState,
        getService: (instance) => instance._service,
        onUnload: (instance) => {
          // Clean up additional subscriptions
          instance._subscription?.unsubscribe()
          revokeHeldObjectUrls(instance._service)
          const state = itemPropertyInstanceState.get(instance)
          if (state?.schemaLiveQuerySubscription) {
            state.schemaLiveQuerySubscription.unsubscribe()
            state.schemaLiveQuerySubscription = null
          }
        },
      })
    } catch {
      // Still try to clean up what we can
      const instanceState = itemPropertyInstanceState.get(this)
      if (instanceState?.liveQuerySubscription) {
        instanceState.liveQuerySubscription.unsubscribe()
        instanceState.liveQuerySubscription = null
      }
      if (instanceState?.schemaLiveQuerySubscription) {
        instanceState.schemaLiveQuerySubscription.unsubscribe()
        instanceState.schemaLiveQuerySubscription = null
      }
      this._subscription?.unsubscribe()
      revokeHeldObjectUrls(this._service)
      try {
        this._service.stop()
      } catch {
        // Service might already be stopped
      }
    }
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
    const cacheKeys = this._cacheKeys()

    clearDestroySubscriptions(this, {
      instanceState: itemPropertyInstanceState,
      onUnload: (instance) => (instance as ItemProperty<any>)._subscription?.unsubscribe(),
    })

    // Out of the cache once its rows are gone (below): removed earlier, a lookup that read a row
    // before the delete applied would build a new instance for it
    const removeFromCaches = () =>
      forceRemoveFromCaches(this, {
        getCacheKeys: () => cacheKeys,
        caches: [ItemProperty.instanceCache as Map<string, unknown>],
      })

    try {
      await this._destroyRows(context)
    } finally {
      removeFromCaches()
    }
  }

  private async _destroyRows(context: PropertyMachineContext): Promise<void> {
    await runDestroyLifecycle(this, {
      getService: (instance) =>
        instance._service as { send: (ev: unknown) => void; stop: () => void },
      doDestroy: async () => {
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
            value: { mode: 'property', propertyNames: [propertyName] } satisfies import('@/outbox').DeleteOp,
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
      },
    })
  }
}