import { ActorRefFrom, createActor, SnapshotFrom, Subscription, waitFor } from 'xstate'
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
import { camelCase, startCase, upperFirst } from 'lodash-es'
import { getPropertyData } from '@/db/read/getPropertyData'
import { getItemProperties } from '@/db/read/getItemProperties'
import { BaseDb } from '@/db/Db/BaseDb'
import {
  BaseFileManager,
  getCorrectId,
  getMetadataPropertyNamesForQuery,
  resolveMetadataRecord,
  resolveStorageNameToSchemaName,
} from '@/helpers'
import type { PropertySchemaEntry } from '@/helpers/metadataPropertyNames'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { findEntity } from '@/helpers/entity/entityFind'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'
import { unloadEntity } from '@/helpers/entity/entityUnload'
import {
  clearDestroySubscriptions,
  forceRemoveFromCaches,
  runDestroyLifecycle,
} from '@/helpers/entity/entityDestroy'
import { eventEmitter } from '@/eventBus'
// Dynamic import to break circular dependency: schema/index -> ... -> ItemProperty -> schema/index
// Note: TProperty is used as a type, so we can import it separately. ModelPropertyDataTypes is used at runtime.
import type { TProperty } from '@/Schema'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { normalizeDataType } from '@/helpers/property'

// Lazy import helper to break circular dependency for synchronous Model access
// Since Model.getByName() is synchronous and Model imports ItemProperty (via Item),
// Model is already initialized when ItemProperty constructor runs
let ModelClass: typeof import('@/Model/Model').Model | null = null
let modelImportPromise: Promise<typeof import('@/Model/Model')> | null = null

// Start loading Model at module load time (non-blocking)
modelImportPromise = import('@/Model/Model').then(module => {
  ModelClass = module.Model
  return module
}).catch(() => {
  // If import fails, ModelClass remains null
  // Return a default module structure to maintain type consistency
  return {} as typeof import('@/Model/Model')
})

const getModel = (): typeof import('@/Model/Model').Model => {
  if (!ModelClass) {
    // Model should already be loaded because Model imports Item, which imports ItemProperty
    // If it's not loaded, this indicates a timing issue
    throw new Error('Model class not available. This may indicate a circular dependency or timing issue.')
  }
  return ModelClass
}

/**
 * Fallback: resolve propertyRecordSchema from schema JSON in DB when Model is not in cache/DB.
 * Used when syncSchemaFromSource failed (e.g. validation error) but schema exists in DB from a previous run.
 */
const resolvePropertyRecordSchemaFromSchemaData = async (
  modelName: string,
  propertyName: string,
  modelType?: string
): Promise<SchemaPropertyType | undefined> => {
  try {
    const { loadAllSchemasFromDb } = await import('@/helpers/schema')
    const allSchemas = await loadAllSchemasFromDb()
    const modelNameAlt = modelType ? upperFirst(camelCase(modelType)) : ''
    for (const { schema } of allSchemas) {
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
  modelType?: string
): Promise<SchemaPropertyType | undefined> => {
  if (!modelName && !modelType) {
    return undefined
  }
  try {
    const { Model } = await import('@/Model/Model')
    const { modelPropertiesToObject } = await import('@/helpers/model')
    let model = modelName ? Model.getByName(modelName) : undefined
    if (!model?.properties?.length && modelType) {
      model = Model.findByModelType(modelType)
    }
    // Fallback: load from DB when not in cache (fixes external app persistence when Model not yet loaded)
    if (!model?.properties?.length && modelName) {
      model = await Model.getByNameAsync(modelName)
    }
    if (!model?.properties?.length && modelType) {
      model = await Model.getByNameAsync(modelTypeToModelName(modelType))
    }
    if (!model?.properties?.length) {
      // Fallback: resolve from schema JSON when Model not in cache/DB (e.g. PermaPress sync failed but schema in DB)
      const schemaProp = await resolvePropertyRecordSchemaFromSchemaData(modelName, propertyName, modelType)
      if (schemaProp) {
        return schemaProp
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
  } catch (e) {
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

// WeakMap to store mutable state per ItemProperty instance
// This avoids issues with read-only properties when instances are frozen by Immer
const itemPropertyInstanceState = new WeakMap<ItemProperty<any>, {
  liveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for cross-instance updates
  schemaLiveQuerySubscription: { unsubscribe: () => void } | null // LiveQuery subscription for properties table (schema changes)
}>()

type ItemPropertyFindProps = {
  propertyName: string
  propertyLocalId?: string
  seedLocalId?: string
  seedUid?: string
  /** When metadata has no modelType, callers (e.g. Item) can pass modelName so ItemProperty.create can succeed */
  modelName?: string
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
  protected _schemaUid: string | undefined

  constructor(initialValues: Partial<CreatePropertyInstanceProps>) {
    const { modelName, propertyName, propertyValue, seedLocalId, seedUid, versionLocalId, versionUid, storageTransactionId, schemaUid, refResolvedValue, refResolvedDisplayValue, localStorageDir, refSeedType } = initialValues

    if (!modelName) {
      throw new Error('Model name is required')
    }

    if (!propertyName) {
      throw new Error(`Property name not provided`)
    }

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
      storageTransactionId,
      // propertyRecordSchema will be loaded from database via loadOrCreateProperty actor
      // or can be provided in initialValues if available
      propertyRecordSchema: initialValues.propertyRecordSchema,
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
    const propertyRecordSchema = initialValues.propertyRecordSchema
    if (propertyRecordSchema) {
      this._dataType = propertyRecordSchema.dataType

      serviceInput.propertyRecordSchema = propertyRecordSchema

      // Use string literals to avoid circular dependency in constructor
      // ModelPropertyDataTypes values are stable string constants
      if (propertyRecordSchema.dataType === 'Relation') {
        this._isRelation = true
      }

        if (propertyRecordSchema.dataType === 'List') {
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
          if (!ItemProperty.instanceCache.has(cacheKey)) {
            ItemProperty.instanceCache.set(cacheKey, {
              instance: this,
              refCount: 1,
            })
          }
        }

        let renderValue

        const isImage =
          propertyRecordSchema &&
          propertyRecordSchema.dataType === ModelPropertyDataTypes.Image

        const isFile =
          propertyRecordSchema &&
          propertyRecordSchema.dataType === ModelPropertyDataTypes.File

        const isItemStorage = 
          propertyRecordSchema &&
          propertyRecordSchema.storageType &&
          propertyRecordSchema.storageType === 'ItemStorage' &&
          context.refResolvedValue &&
          context.localStorageDir

        const isHtml =
          (context.refSeedType === 'html' || (propertyRecordSchema?.dataType === ModelPropertyDataTypes.Html)) &&
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
          const blobUrl = URL.createObjectURL(fileOrBlob)
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
          const filePath = BaseFileManager.getFilesPath(dir, context.refResolvedValue)
          try {
            const exists = await BaseFileManager.pathExists(filePath)
            if (exists && (isItemStorage || isHtml)) {
              renderValue = await BaseFileManager.readFileAsString(filePath,)
            }
            if (exists && isImage) {
              if (context.refResolvedDisplayValue) {
                renderValue = context.refResolvedDisplayValue
              } 
              if (!context.refResolvedDisplayValue) {
                renderValue = await BaseFileManager.getContentUrlFromPath(filePath)
              }
            }
            if (exists && isFile) {
              renderValue = await BaseFileManager.readFileAsString(filePath,)
            }
            if (!exists) {
              // Keep filename for display when File object is present but not yet saved to disk
              if (isFile && isFileValue) {
                renderValue = (pv as unknown as File).name
              } else if (isImage) {
                // FS race / path not visible yet: do not clobber a hydrated blob URL with "No file found"
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
            renderValue = 'No file found'
          }
        }

        if (!renderValue) {
          renderValue = context.renderValue || context.propertyValue
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

        // Update context with renderValue instead of BehaviorSubject
        // The reactive proxy will handle reactivity
        const currentRenderValue = context.renderValue || context.propertyValue
        if (currentRenderValue === renderValue) {
          return
        }

        // Update context with new renderValue
        this._service.send({
          type: 'updateContext',
          renderValue,
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
        const propertyNameVariant = propertyNames.length > 1 ? propertyNames[1] : undefined

        const seedSchemaMod = await import('../seedSchema')
        const { metadata } = seedSchemaMod
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
        const initialMetadata = await db
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
            refResolvedDisplayValue: metaRow.refResolvedDisplayValue || undefined,
            localStorageDir: metaRow.localStorageDir || undefined,
          })
        }

        // Only set up liveQuery subscription in browser environment
        if (isBrowser) {
          // Set up liveQuery to watch metadata table for this property
          // Use proper SQL parameter binding - ensure values are strings, not objects
          const resolvedSeedUid = seedUid || null
          const resolvedSeedLocalId = seedLocalId || null
          
          // For File/Image/Relation, query both propertyName and propertyNameId (metadata stores with Id suffix)
          // Build query with primitive params only (SQLocal bind rejects SQL fragment objects)
          const [p0, p1, p2] = propertyNames
          const metadata$ = BaseDb.liveQuery<{ localId: string | null; uid: string | null; propertyName: string; propertyValue: string; versionLocalId: string | null; versionUid: string | null; schemaUid: string | null; refResolvedValue: string | null; refResolvedDisplayValue: string | null; localStorageDir: string | null }>(
            (sql: any) => {
              if (resolvedSeedUid) {
                if (propertyNames.length === 1) {
                  return sql`
                    SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                           version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                           ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                    FROM metadata
                    WHERE seed_uid = ${resolvedSeedUid} AND property_name = ${p0} AND property_name IS NOT NULL
                    ORDER BY COALESCE(attestation_created_at, created_at) DESC LIMIT 1
                  `
                }
                if (propertyNames.length === 2) {
                  return sql`
                    SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                           version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                           ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                    FROM metadata
                    WHERE seed_uid = ${resolvedSeedUid} AND (property_name = ${p0} OR property_name = ${p1}) AND property_name IS NOT NULL
                    ORDER BY COALESCE(attestation_created_at, created_at) DESC LIMIT 1
                  `
                }
                if (propertyNames.length >= 3) {
                  return sql`
                    SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                           version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                           ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                    FROM metadata
                    WHERE seed_uid = ${resolvedSeedUid} AND (property_name = ${p0} OR property_name = ${p1} OR property_name = ${p2}) AND property_name IS NOT NULL
                    ORDER BY COALESCE(attestation_created_at, created_at) DESC LIMIT 1
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
                    ORDER BY COALESCE(attestation_created_at, created_at) DESC LIMIT 1
                  `
                }
                if (propertyNames.length === 2) {
                  return sql`
                    SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                           version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                           ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                    FROM metadata
                    WHERE seed_local_id = ${resolvedSeedLocalId} AND (property_name = ${p0} OR property_name = ${p1}) AND property_name IS NOT NULL
                    ORDER BY COALESCE(attestation_created_at, created_at) DESC LIMIT 1
                  `
                }
                if (propertyNames.length >= 3) {
                  return sql`
                    SELECT local_id as localId, uid, property_name as propertyName, property_value as propertyValue, 
                           version_local_id as versionLocalId, version_uid as versionUid, schema_uid as schemaUid,
                           ref_resolved_value as refResolvedValue, ref_resolved_display_value as refResolvedDisplayValue, local_storage_dir as localStorageDir
                    FROM metadata
                    WHERE seed_local_id = ${resolvedSeedLocalId} AND (property_name = ${p0} OR property_name = ${p1} OR property_name = ${p2}) AND property_name IS NOT NULL
                    ORDER BY COALESCE(attestation_created_at, created_at) DESC LIMIT 1
                  `
                }
              }
              return sql`SELECT 1 WHERE 1 = 0`
            }
          )

          const instanceState = itemPropertyInstanceState.get(this)
          if (!instanceState) {
            logger('[ItemProperty._setupLiveQuerySubscription] Instance state not found')
            return
          }

          // Subscribe to liveQuery updates
          const subscription = metadata$.subscribe({
            next: async (metadataRows) => {
              if (metadataRows.length === 0) return
              
              const metaRow = metadataRows[0]
              logger(`[ItemProperty._setupLiveQuerySubscription] Metadata updated in database for propertyName: ${propertyName}`)
              
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
                refResolvedDisplayValue: metaRow.refResolvedDisplayValue || undefined,
                localStorageDir: metaRow.localStorageDir || undefined,
              })
            },
            error: (error) => {
              logger(`[ItemProperty._setupLiveQuerySubscription] LiveQuery error: ${error}`)
            },
          })

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
        }>(
          (sql: any) => sql`
            SELECT p.data_type as dataType, p.ref_value_type as refValueType, ref.name as refModelName
            FROM properties p
            INNER JOIN models m ON p.model_id = m.id
            LEFT JOIN models ref ON p.ref_model_id = ref.id
            WHERE m.name = ${modelName} AND p.name = ${propertyName}
            LIMIT 1
          `
        )

        const instanceState = itemPropertyInstanceState.get(this)
        if (!instanceState) {
          logger('[ItemProperty._setupPropertySchemaLiveQuery] Instance state not found')
          return
        }

        const subscription = schema$.subscribe({
          next: (rows) => {
            if (rows.length === 0) return

            const row = rows[0]
            const propertyRecordSchema = {
              dataType: row.dataType,
              ref: row.refModelName || undefined,
              refValueType: row.refValueType || undefined,
              storageType: undefined as string | undefined,
              localStorageDir: undefined as string | undefined,
              filenameSuffix: undefined as string | undefined,
            }

            logger(`[ItemProperty._setupPropertySchemaLiveQuery] Schema updated for ${propertyName}: dataType=${row.dataType}`)

            this._service.send({
              type: 'updateContext',
              propertyRecordSchema,
            })

            // Update instance fields to match new schema (mirror constructor logic)
            this._dataType = propertyRecordSchema.dataType
            if (propertyRecordSchema.dataType === 'Relation') {
              ;(this as any)._isRelation = true
            } else {
              ;(this as any)._isRelation = false
            }
            if (propertyRecordSchema.dataType === 'List') {
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

  static create(
    props: Partial<CreatePropertyInstanceProps>,
    options?: { waitForReady?: false },
  ): ItemProperty<any> | undefined
  static create(
    props: Partial<CreatePropertyInstanceProps>,
    options?: { waitForReady?: true; readyTimeout?: number },
  ): Promise<ItemProperty<any> | undefined>
  static create(
    props: Partial<CreatePropertyInstanceProps>,
    options?: CreateWaitOptions,
  ): ItemProperty<any> | undefined | Promise<ItemProperty<any> | undefined> {
    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? 5000

    const { propertyName, seedLocalId, seedUid, versionLocalId, versionUid } =
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
      const { instance, refCount } = this.instanceCache.get(lookupKey)!
      const entry = { instance, refCount: refCount + 1 }
      this.instanceCache.set(lookupKey, entry)
      const otherKey = lookupKey === keyByLocal ? keyByUid : keyByLocal
      if (otherKey) this.instanceCache.set(otherKey, entry)
      // On cache hit, sync refResolvedValue/refResolvedDisplayValue/localStorageDir/refSeedType when incoming has them
      // but cached instance doesn't (e.g. Item constructor created from schema first, then loadOrCreateItem
      // has metadata with refResolvedValue - we must not lose display data).
      const ctx = (instance as ItemProperty<any>)._getSnapshotContext()
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
        const proxiedInstance = createReactiveProxy<ItemProperty<any>>({
          instance: newInstance,
          service: newInstance._service,
          trackedProperties: TRACKED_PROPERTIES,
          getContext: (instance) => {
            return instance._getSnapshotContext()
          },
          sendUpdate: (instance, prop: string, value: any) => {
            instance._service.send({
              type: 'updateContext',
              [prop]: value,
            })
          },
        })
        
        const entry = { instance: proxiedInstance, refCount: 1 }
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
        const proxiedInstance = createReactiveProxy<ItemProperty<any>>({
          instance: newInstance,
          service: newInstance._service,
          trackedProperties: TRACKED_PROPERTIES,
          getContext: (instance) => {
            return instance._getSnapshotContext()
          },
          sendUpdate: (instance, prop: string, value: any) => {
            instance._service.send({
              type: 'updateContext',
              [prop]: value,
            })
          },
        })
        
        const entry = { instance: proxiedInstance, refCount: 1 }
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
    const result = createReactiveProxy<ItemProperty<any>>({
      instance: newInstance,
      service: newInstance._service,
      trackedProperties: TRACKED_PROPERTIES,
      getContext: (instance) => {
        return instance._getSnapshotContext()
      },
      sendUpdate: (instance, prop: string, value: any) => {
        instance._service.send({
          type: 'updateContext',
          [prop]: value,
        })
      },
    })
    if (!waitForReady) return result
    return waitForEntityIdle(result, { timeout: readyTimeout }).then(
      () => result,
    )
  }

  static async find({
    propertyName,
    seedLocalId,
    seedUid,
    modelName: modelNameOption,
    waitForReady = true,
    readyTimeout = 5000,
  }: ItemPropertyFindProps & {
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<ItemProperty<any> | undefined> {
    if ((!seedLocalId && !seedUid) || !propertyName) {
      return undefined
    }
    
    const cacheKeyId = seedUid || seedLocalId
    const cacheKey = ItemProperty.cacheKey(cacheKeyId!, propertyName)
    let foundProperty: ItemProperty<any> | undefined
    
    // Check cache first
    if (this.instanceCache.has(cacheKey)) {
      const { instance, refCount } = this.instanceCache.get(cacheKey)!
      this.instanceCache.set(cacheKey, {
        instance,
        refCount: refCount + 1,
      })
      foundProperty = instance as ItemProperty<any>
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
        data.modelType
      )
      foundProperty = ItemProperty.create(
        { ...propertyData, modelName, propertyRecordSchema },
        { waitForReady: false },
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
   */
  static async all(
    params: { seedLocalId?: string; seedUid?: string },
    options?: { waitForReady?: boolean; readyTimeout?: number },
  ): Promise<ItemProperty<any>[]> {
    const { waitForReady = false, readyTimeout = 5000 } = options ?? {}
    const { seedLocalId, seedUid } = params
    if (!seedLocalId && !seedUid) {
      return []
    }

    const propertiesData = await getItemProperties({ seedLocalId, seedUid })
    const instances: ItemProperty<any>[] = []
    const seenNormalized = new Set<string>()

    for (const data of propertiesData) {
      const d = data as { modelName?: string; modelType?: string; propertyName?: string; refSeedType?: string }
      const modelName =
        d.modelName ?? (d.modelType ? modelTypeToModelName(d.modelType) : '') ?? ''
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
          const model = await Model.getByNameAsync(modelName)
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
          const model = await Model.getByNameAsync(modelName)
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
        ? await resolvePropertyRecordSchemaFromModel(modelName, propertyName, d.modelType)
        : undefined
      const createProps = {
        ...data,
        propertyName,
        modelName,
        propertyRecordSchema,
      }
      const instance = this.create(createProps, { waitForReady: false })
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

  static cacheKey(seedLocalIdOrUid: string, propertyName: string): string {
    const { uid, localId } = getCorrectId(seedLocalIdOrUid)
    return `Item_${uid || localId}_${propertyName}`
  }

  /** Clears instance cache for an item (for test isolation when run in group). */
  static clearInstanceCacheForItem(seedLocalIdOrUid: string): void {
    const { uid, localId } = getCorrectId(seedLocalIdOrUid)
    const prefix = `Item_${uid || localId}_`
    for (const key of Array.from(this.instanceCache.keys())) {
      if (key.startsWith(prefix)) this.instanceCache.delete(key)
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
    return this._getSnapshotContext().propertyName || ''
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

  /** Validation errors from last failed save (enum, pattern, minLength, maxLength). Cleared on successful save. */
  get saveValidationErrors(): import('@/Schema/validation').ValidationError[] {
    return this._getSnapshotContext()._saveValidationErrors ?? []
  }

  get alias() {
    return this._alias
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
    // Update context immediately so UI shows the value before save completes
    this._service.send({
      type: 'updateContext',
      propertyValue: value,
      renderValue: value,
    })

    // If no propertyRecordSchema, try to resolve from Model before persisting (fixes external app persistence)
    if (!context.propertyRecordSchema) {
      const { modelName, propertyName, modelType } = context as { modelName?: string; propertyName?: string; modelType?: string }
      void resolvePropertyRecordSchemaFromModel(modelName ?? '', propertyName ?? '', modelType).then(
        (schema) => {
          if (schema) {
            this._service.send({ type: 'updateContext', propertyRecordSchema: schema })
            this._service.send({ type: 'save', newValue: value })
          }
        }
      )
    } else {
      this._service.send({
        type: 'save',
        newValue: value,
      })
    }
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
    const { assertItemOwned } = await import('@/helpers/ownership')
    await assertItemOwned({
      seedLocalId: ctx?.seedLocalId ?? undefined,
      seedUid: ctx?.seedUid ?? undefined,
    })
    await waitFor(
      this._service,
      (snapshot) => !snapshot.context.isSaving && snapshot.value === 'idle',
      {
        timeout: 10_000,
      },
    )
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

  unload() {
    try {
      const context = this._getSnapshotContext()
      const cacheKey = ItemProperty.cacheKey(
        context.seedUid || context.seedLocalId || '',
        context.propertyName || ''
      )
      const cacheKeys: string[] = []
      
      if (cacheKey && cacheKey !== 'Item__') {
        cacheKeys.push(cacheKey)
      }
      
      unloadEntity(this, {
        getCacheKeys: () => cacheKeys,
        caches: [ItemProperty.instanceCache],
        instanceState: itemPropertyInstanceState,
        getService: (instance) => instance._service,
        onUnload: (instance) => {
          // Clean up additional subscriptions
          instance._subscription?.unsubscribe()
          const state = itemPropertyInstanceState.get(instance)
          if (state?.schemaLiveQuerySubscription) {
            state.schemaLiveQuerySubscription.unsubscribe()
            state.schemaLiveQuerySubscription = null
          }
        },
      })
    } catch (error) {
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
      try {
        this._service.stop()
      } catch {
        // Service might already be stopped
      }
    }
  }

  /**
   * Destroy the item property: remove from caches, delete metadata from DB, remove from parent Item, stop service.
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const cacheKey = ItemProperty.cacheKey(
      context.seedUid || context.seedLocalId || '',
      context.propertyName || '',
    )
    const cacheKeys: string[] = cacheKey && cacheKey !== 'Item__' ? [cacheKey] : []

    clearDestroySubscriptions(this, {
      instanceState: itemPropertyInstanceState,
      onUnload: (instance) => (instance as ItemProperty<any>)._subscription?.unsubscribe(),
    })

    forceRemoveFromCaches(this, {
      getCacheKeys: () => cacheKeys,
      caches: [ItemProperty.instanceCache as Map<string, unknown>],
    })

    await runDestroyLifecycle(this, {
      getService: (instance) =>
        instance._service as { send: (ev: unknown) => void; stop: () => void },
      doDestroy: async () => {
        const db = BaseDb.getAppDb()
        const seedLocalId = context.seedLocalId
        const seedUid = context.seedUid
        const propertyName = context.propertyName
        if (!propertyName || (!seedLocalId && !seedUid)) return

        if (db) {
          const seedSchemaMod = await import('../seedSchema')
          const { metadata } = seedSchemaMod
          const drizzleMod = await import('drizzle-orm')
          const { and, eq, or } = drizzleMod
          const conditions = [eq(metadata.propertyName, propertyName)]
          if (seedLocalId && seedUid) {
            conditions.push(or(eq(metadata.seedLocalId, seedLocalId), eq(metadata.seedUid, seedUid)) as any)
          } else if (seedLocalId) {
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
        const item = Item.getById((seedLocalId || seedUid) as string)
        if (item) {
          item.getService().send({ type: 'removePropertyInstance', propertyName })
        }
      },
    })
  }
}