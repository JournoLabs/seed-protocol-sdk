import { ActorRefFrom, createActor, SnapshotFrom, waitFor } from 'xstate'
import { modelMachine, ModelMachineContext } from './service/modelMachine'
import { createModelProperties } from './createModelProperties'
import { saveDefinition } from '@/db/write/saveDefinition'
import { createReactiveProxy } from '@/helpers/reactiveProxy'
import { Item } from '@/Item/Item'
import type { CreateWaitOptions } from '@/types'
import { ItemData } from '@/types/item'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { ConflictError, ConflictResult } from '@/Schema/errors'
import { isClientReady } from '@/client/readiness'
import { renameModelInDb } from '@/helpers/db'
import { modelPropertiesToObject } from '@/helpers/model'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { setupEntityLiveQuery } from '@/helpers/entity/entityLiveQuery'
import { isActorStopped, sameEntity } from '@/helpers/entity/entityCommon'
import { EntityCache, evictionLog } from '@/helpers/entity/entityCache'
import {
  DEFAULT_READY_TIMEOUT_MS,
  destroyEntity,
  entityStatus,
  evictEntities,
  isEntityTornDown,
  releaseEntity,
  runEntityLoad,
  waitForEntityReady,
} from '@/helpers/entity/entityLifecycle'
import { loadModel } from './loadModel'
import { getModelsData } from '@/db/read/getModelsData'
import { localNamesInBestMatchTier } from '@seedprotocol/eas'
import { currentNameMatchLevels } from '@/db/read/nameMatchLevels'
import { eq, or } from 'drizzle-orm'
import { AmbiguousModelError } from './errors'
import { getDraftSaveError, queueDraftSave, trackDraftSave } from '@/helpers/entity/draftSaveErrors'
import debug from 'debug'

const logger = debug('seedSdk:model:Model')
const saveDraftLogger = debug('seedSdk:model:saveDraftToDb')

type ModelService = ActorRefFrom<typeof modelMachine>
type ModelSnapshot = SnapshotFrom<typeof modelMachine>

// Lazy import cache for ModelProperty to avoid circular dependency
// Eagerly start loading to minimize delay on first access
let ModelPropertyClass: any = null
const modelPropertyImportPromise = import('@/ModelProperty/ModelProperty')
  .then(module => {
    ModelPropertyClass = module.ModelProperty
    return ModelPropertyClass
  })
  .catch(() => {
    // If import fails, ModelPropertyClass remains null
    return null
  })

function getModelProperty(): any {
  // Return cached class if available (synchronous access)
  // Note: On first access before import completes, this will return null
  // and the getter will return empty array, which matches the original behavior
  return ModelPropertyClass
}

// Models writing their row or creating their properties, keyed by actor. Their own snapshot ends
// the write, so the live query doesn't look their row up on its timer meanwhile.
const modelWritesInFlight = new WeakSet<object>()

/** The models row with this file id, if one exists. */
const findModelRowId = async (modelFileId: string): Promise<number | undefined> => {
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  const [row] = await db
    .select({ id: modelsTable.id })
    .from(modelsTable)
    .where(eq(modelsTable.schemaFileId, modelFileId))
    .limit(1)
  return row?.id
}

/**
 * The schemas row a new model links to: the Schema instance's row (by row id, then file id), or
 * with a schema name only, the row of that name.
 */
const findSchemaRowId = async (schemaInstance: any, schemaName: string): Promise<number | undefined> => {
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  const context = schemaInstance?._getSnapshotContext()
  const lookups = schemaInstance
    ? [
        typeof context._dbId === 'number' ? eq(schemasTable.id, context._dbId) : undefined,
        context.id ? eq(schemasTable.schemaFileId, context.id) : undefined,
      ]
    : [eq(schemasTable.name, schemaName)]
  for (const where of lookups) {
    if (!where) continue
    const [row] = await db.select({ id: schemasTable.id }).from(schemasTable).where(where).limit(1)
    if (row) return row.id
  }
  return undefined
}

/** The properties a model's write stores: those passed to Model.create, else its instances'. */
const propertiesToWrite = (instance: Model): { [name: string]: any } => {
  const pending = instance.getService().getSnapshot().context._pendingPropertyDefinitions
  if (!pending) return modelPropertiesToObject(instance.properties || [])
  const properties = JSON.parse(JSON.stringify(pending)) as { [name: string]: any }
  for (const [name, definition] of Object.entries(properties)) {
    if (definition.dataType && !definition.type) properties[name] = { ...definition, type: definition.dataType }
  }
  return properties
}

// Define tracked properties for the Proxy
// These properties will be read from/written to the actor context
/** The name key a model is cached under besides its id. */
const modelKey = (schemaName: string | undefined, modelName: string | undefined) =>
  schemaName && modelName ? `${schemaName}:${modelName}` : undefined

const TRACKED_PROPERTIES = [
  'id', // schemaFileId (string) - public ID
  'modelName',
  'schemaName',
] as const

export class Model {
  /** Cached under its id and `schemaName:modelName` (ADR 0014). */
  static readonly cache = new EntityCache<Model>()

  protected readonly _service: ModelService

  modelName?: string
  schemaName?: string
  _properties?: any[] // Internal properties array (use getter for public access)
  // 'name' is available as an alias for 'modelName' via the proxy

  constructor(
    modelName: string,
    schemaName: string,
    id?: string, // schemaFileId (string) - public ID
    initialContext?: Pick<ModelMachineContext, '_pendingPropertyDefinitions'>,
    idFromSchema?: boolean // true when id was provided via options (schema model), not generated
  ) {
    const serviceInput: Pick<ModelMachineContext, 'modelName' | 'schemaName' | 'id' | '_pendingPropertyDefinitions' | '_idFromSchema'> = {
      modelName,
      schemaName,
      ...(id ? { id } : {}),
      ...(initialContext?._pendingPropertyDefinitions ? { _pendingPropertyDefinitions: initialContext._pendingPropertyDefinitions } : {}),
      _idFromSchema: !!idFromSchema,
    }

    this._service = createActor(modelMachine as any, {
      input: serviceInput,
    }) as ModelService

    this._service.start()

    // Set up liveQuery subscription for cross-instance property updates
    this._setupLiveQuerySubscription()
    // Note: Property getters/setters are now handled by the Proxy in create()
  }

  /**
   * Load the model from its row (or its schema's definition, or as new), then cache it under its
   * final id and name. Another cached instance that already has the loaded id keeps it.
   */
  private static async load(instance: Model): Promise<void> {
    const service = instance.getService()
    const loaded = await loadModel(service.getSnapshot().context, () => isEntityTornDown(instance))
    if (isEntityTornDown(instance)) return
    service.send({ type: 'loaded', model: loaded })
    const { id, schemaName, modelName } = service.getSnapshot().context
    const other = id ? Model.cache.peek(id) : undefined
    if (other && !sameEntity(other, instance)) return
    Model.cache.setKeys(instance, [id, modelKey(schemaName, modelName)])
    // The load cached its properties before this model had its row id, so they couldn't find it
    const ModelProperty = getModelProperty()
    for (const propertyFileId of loaded._liveQueryPropertyIds ?? []) {
      const property = ModelProperty?.getById(propertyFileId)
      if (property) ModelProperty.holdForModel(property, instance)
    }
  }

  /**
   * Writes the row of a model Model.create made, or adopts the row its schema import wrote for its
   * id, then creates the properties passed to create from their rows. Rejects when the model fails
   * validation, is unloaded, or its schema has no row.
   */
  private static async persistNewModel(
    instance: Model,
    options: {
      schemaInstance?: any
      schemaName: string
      persistedBy?: Promise<unknown>
      adoptExistingRow: boolean
    },
  ): Promise<void> {
    const service = instance.getService()
    const ensureRunning = () => {
      // Unloaded or evicted (e.g. Schema.destroy): a stopped model writes nothing
      if (isActorStopped(service)) throw new Error('the model was unloaded')
    }
    // The caller writes this model's rows; wait for that so two writers don't write them at once
    await options.persistedBy?.catch(() => {})
    ensureRunning()
    const { context } = service.getSnapshot()
    if (context._validationErrors?.length) throw new Error('the model failed validation')
    if (!context.id) throw new Error('it has no id')

    modelWritesInFlight.add(service)
    try {
      let dbId = options.adoptExistingRow ? await findModelRowId(context.id) : undefined
      if (dbId === undefined) {
        const schemaId = await findSchemaRowId(options.schemaInstance, options.schemaName)
        if (!schemaId) throw new Error(`its schema "${options.schemaName}" was not found in the database`)
        ensureRunning()
        const current = service.getSnapshot().context
        dbId = await saveDefinition({
          type: 'model',
          modelFileId: current.id!,
          modelName: current.modelName,
          schemaId,
          properties: propertiesToWrite(instance),
        })
      } else {
        logger(`Model "${context.modelName}" adopts model row ${dbId} written by its schema import`)
      }
      ensureRunning()
      service.send({ type: 'updateContext', _dbId: dbId })

      const definitions = service.getSnapshot().context._pendingPropertyDefinitions
      if (definitions && Object.keys(definitions).length > 0) {
        await createModelProperties(instance, definitions)
        ensureRunning()
        service.send({ type: 'updateContext', _pendingPropertyDefinitions: undefined })
        // Node has no live query to pick up the new property rows
        await instance._refreshPropertiesFromDb()
      }
    } finally {
      modelWritesInFlight.delete(service)
    }
  }

  /**
   * True when a name-cached instance belongs to a different model than the requested modelFileId.
   * A schema re-imported under the same name can give its models new ids while the previous
   * instances are still cached by name; Model.create must not hand those back for the new id.
   */
  private static isOtherModelId(cachedId: string | undefined, requestedId: string | undefined): boolean {
    return !!requestedId && !!cachedId && cachedId !== requestedId
  }

  /** Names of the cached models of a schema, leaving out the model with `exceptId`. */
  static cachedModelNames(schemaName: string, exceptId?: string): string[] {
    return this.cache
      .instances((model) => {
        const context = model._getSnapshotContext()
        return context.schemaName === schemaName && (!exceptId || context.id !== exceptId)
      })
      .map((model) => model._getSnapshotContext().modelName)
      .filter(Boolean)
  }

  /**
   * Find a unique model name by checking for duplicates (case-insensitive) in the cache
   * If duplicates are found, appends an incrementing number to make it unique
   * 
   * @param modelName - The desired model name
   * @param schemaName - The schema name
   * @param skipAllChecks - If true, skip all duplicate checks and return original name (used when creating schema models to preserve original names)
   * @returns A unique model name
   */
  static findUniqueModelName(modelName: string, schemaName: string, skipAllChecks: boolean = false): string {
    // If skipAllChecks is true (schema models), preserve original name
    if (skipAllChecks) {
      return modelName
    }
    
    const lowerModelName = modelName.toLowerCase()
    const existingNumbers = new Set<number>()
    for (const cachedModelName of this.cachedModelNames(schemaName)) {
      const lowerCachedName = cachedModelName.toLowerCase()
      if (lowerCachedName === lowerModelName) {
        existingNumbers.add(0) // Base name exists
      } else if (lowerCachedName.startsWith(lowerModelName + ' ')) {
        // The base name followed by a space and a number
        const suffix = lowerCachedName.slice(lowerModelName.length + 1)
        const number = parseInt(suffix, 10)
        if (!isNaN(number) && suffix === number.toString()) existingNumbers.add(number)
      }
    }

    // If no duplicates found (no base name match and no numbered variants), return original name
    if (existingNumbers.size === 0) {
      return modelName
    }
    
    // Find the next available number, starting from 1
    let nextNumber = 1
    while (existingNumbers.has(nextNumber)) {
      nextNumber++
    }
    
    // Return the name with the number appended
    return `${modelName} ${nextNumber}`
  }

  /**
   * Create a new Model instance or return existing cached instance
   * 
   * @param modelName - The name of the model
   * @param schemaNameOrSchema - The schema name (string) or Schema instance
   * @param options - Optional configuration (can be omitted to create model with empty properties):
   *   - modelFileId: Pre-existing model file ID
   *   - properties: Model properties definition (defaults to empty object if not provided)
   *   - registerWithSchema: Whether to automatically register this model with its schema (default: true if schema instance provided)
   * 
   * @example
   * // Create model with empty properties
   * const model = Model.create('MyModel', schema)
   * 
   * @example
   * // Create model with properties
   * const model = Model.create('MyModel', schema, {
   *   properties: { title: { dataType: 'String' } }
   * })
   */
  static create(
    modelName: string,
    schemaNameOrSchema: string | any, // Schema type - using any to avoid circular dependency
    options: {
      id?: string
      modelFileId?: string
      properties?: { [propertyName: string]: any }
      registerWithSchema?: boolean
      waitForReady: false
      /** @internal Schema import: see the implementation signature */
      persistedBy?: Promise<unknown>
      /** @internal SDK lookups pass false: see the implementation signature */
      hold?: false
    },
  ): Model
  static create(
    modelName: string,
    schemaNameOrSchema: string | any,
    options?: {
      id?: string
      modelFileId?: string
      properties?: { [propertyName: string]: any }
      registerWithSchema?: boolean
      waitForReady?: true
      readyTimeout?: number
      /** @internal SDK lookups pass false: see the implementation signature */
      hold?: false
    },
  ): Promise<Model>
  static create(
    modelName: string,
    schemaNameOrSchema: string | any, // Schema type - using any to avoid circular dependency
    options?: {
      id?: string // schemaFileId (string) - public ID (deprecated, use modelFileId)
      modelFileId?: string // Pre-existing model file ID (preferred)
      properties?: { [propertyName: string]: any }
      registerWithSchema?: boolean
      /**
       * @internal Settles once the caller has written this model's rows itself (schema import runs
       * addModelsToDb). A new instance waits for it and adopts its model row instead of writing; with no
       * row for its id by then, it writes as usual.
       */
      persistedBy?: Promise<unknown>
      /**
       * @internal false for SDK code that only looks the model up: no hold is taken, and a model
       * loaded here is cached with none, so its users' last unload still stops it.
       */
      hold?: false
    } & CreateWaitOptions,
  ): Model | Promise<Model> {
    if (!modelName) {
      throw new Error('Model name is required')
    }

    const waitForReady = options?.waitForReady !== false
    const readyTimeout = options?.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS
    const holds = options?.hold === false ? 0 : 1

    // Extract schema name and instance
    let schemaName: string
    let schemaInstance: any | undefined // Using any to avoid circular dependency with Schema
    if (typeof schemaNameOrSchema === 'string') {
      schemaName = schemaNameOrSchema
    } else {
      schemaInstance = schemaNameOrSchema
      schemaName = schemaInstance.schemaName
    }

    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    // Support both modelFileId (documented) and id (backward compatibility)
    const id = options?.modelFileId || options?.id // schemaFileId (string) - public ID
    const registerWithSchema = options?.registerWithSchema !== false && schemaInstance !== undefined

    // A model with this id is cached: that instance
    const cachedById = id ? this.cache.peek(id) : undefined
    if (cachedById) {
      if (holds) this.cache.holdInstance(cachedById)
      logger(`Model.create: Found instance in ID cache for "${modelName}" (ID: ${id})`)
      if (!waitForReady) return cachedById
      return waitForEntityReady(cachedById, { timeout: readyTimeout }).then(() => cachedById)
    }

    // A runtime create (no id) gets a new model, numbered when the name is taken ("My Model 1");
    // a schema model (with id) keeps its name.
    const uniqueModelName = this.findUniqueModelName(modelName, schemaName, !!id)
    if (uniqueModelName !== modelName) {
      logger(`Model.create: Found duplicate name "${modelName}" in schema "${schemaName}", using unique name "${uniqueModelName}"`)
    }
    const resolvedId = id ?? generateId()

    // The id and the properties to create go in the initial context, so the load sees them
    const initialContext = options?.properties 
      ? { _pendingPropertyDefinitions: JSON.parse(JSON.stringify(options.properties)) } as Pick<ModelMachineContext, '_pendingPropertyDefinitions'>
      : undefined
    
    // Use the unique model name for the instance (idFromSchema: true when id was provided, so schema model is not renamed)
    const newInstance = new this(uniqueModelName, schemaName, resolvedId, initialContext, !!id)
    
    if (options?.properties) {
      logger(`[Model.create] Created instance with _pendingPropertyDefinitions in initial context (${Object.keys(options.properties).length} properties) for model "${uniqueModelName}"`)
    }

    // Wrap instance in Proxy for reactive property access. `name` is an alias for `modelName`.
    const sendUpdate = (target: Model, prop: string, value: unknown) => {
      if (prop === 'modelName') {
        // Model name change - need to update Schema and database
        const context = target._getSnapshotContext()
        const oldName = context.modelName
        const newName = value as string

        if (oldName === newName) {
          logger(`Model name unchanged: "${oldName}"`)
          return
        }

        logger(`Updating model name from "${oldName}" to "${newName}"`)

        Model.cache.setKeys(target, [context.id, modelKey(context.schemaName, newName)])

        // Update Model context
        target._service.send({
          type: 'updateContext',
          modelName: newName,
        })

        // Mark model as draft
        target._service.send({
          type: 'markAsDraft',
          propertyKey: 'modelName',
        })

        // Save draft to database immediately so changes persist
        trackDraftSave(target._service, target._saveDraftToDb(oldName, newName), `Model "${newName}"`)

        // NOTE: Schema is not notified of model name changes during edits.
        // Schema will read from Model instances when persisting/saving.
      } else {
        // Standard property update
        target._service.send({
          type: 'updateContext',
          [prop]: value,
        })
      }
    }
    const proxiedInstance = createReactiveProxy<Model>({
      instance: newInstance,
      service: newInstance._service,
      trackedProperties: TRACKED_PROPERTIES,
      getContext: (target) => target._getSnapshotContext(),
      sendUpdate,
      resolve: (target, prop) => {
        if (prop === 'name') {
          return {
            get: () => target._getSnapshotContext().modelName,
            set: (value) => sendUpdate(target, 'modelName', value),
          }
        }
        return undefined
      },
      virtualKeys: () => ['name'],
      onSet: (_target, prop) => {
        if (prop === 'properties') {
          // Properties are read-only computed values from ModelProperty instances
          throw new Error('Cannot set model.properties directly. Properties are computed from ModelProperty instances.')
        }
        if (prop === 'description') {
          // Description is not supported - JSON files can have it but we ignore it at runtime
          throw new Error('Cannot set model.description. Description is not supported in runtime Model instances.')
        }
      },
    }) as Model
    
    // A runtime create gets its name key once its load settles the name (it may be numbered)
    this.cache.add(proxiedInstance, [resolvedId, id ? modelKey(schemaName, uniqueModelName) : undefined], {
      hold: holds === 1,
    })
    logger(`Model.create: Created new instance for "${uniqueModelName}" (ID: ${id})`)

    // Step 11: Register with schema if requested, OR trigger write if properties are provided
    // If properties are provided, we need to write the model to get modelId for property creation
    // If schema provided, trigger write process instead of registration
    // When schemaName is passed as string (e.g. useCreateModel), we must trigger write so runtime-created
    // models get persisted to DB and show up in useModels (which queries the database).
    const hasProperties = !!options?.properties && Object.keys(options.properties).length > 0
    const shouldTriggerWrite =
      (registerWithSchema && schemaInstance) ||
      hasProperties ||
      typeof schemaNameOrSchema === 'string'
    // Every DB load (createById, getByNameAsync, ...) also passes a string schema and no properties.
    // Such a model adopts its existing row: writing it again rewrote each property row and cleared is_edited.
    const adoptExistingRow =
      !!options?.persistedBy || (typeof schemaNameOrSchema === 'string' && !hasProperties)
    // Ready once loaded, and when properties were passed, once they exist
    void runEntityLoad(proxiedInstance, async () => {
      await Model.load(proxiedInstance)
      if (!shouldTriggerWrite) return
      const persisted = Model.persistNewModel(proxiedInstance, {
        schemaInstance,
        schemaName,
        persistedBy: options?.persistedBy,
        adoptExistingRow,
      })
      if (!hasProperties) {
        persisted.catch((error) => logger(`Model "${uniqueModelName}" was not written: ${error}`))
        return
      }
      await persisted.catch((error) => {
        const reason = error instanceof Error ? error.message : String(error)
        const name = proxiedInstance.getService().getSnapshot().context.modelName
        throw new Error(`Model "${name}" could not create its properties: ${reason}`)
      })
    })

    if (!waitForReady) return proxiedInstance
    return waitForEntityReady(proxiedInstance, { timeout: readyTimeout }).then(() => proxiedInstance)
  }

  /**
   * Get Model instance by modelFileId (O(1) lookup). Takes a hold on the instance; release it with
   * `unload()`.
   */
  static getById(modelFileId: string): Model | undefined {
    return this.cache.hold(modelFileId)
  }

  /**
   * Models their schema holds, by modelFileId. A schema's first load of a model takes one hold for
   * the schema, and the schema's last unload releases it (releaseSchemaHolds), so a user's unload
   * can't drop a model out of `schema.models` while the schema is loaded.
   */
  private static schemaHeldModelIds = new Set<string>()

  /**
   * @internal For a Schema loading its models: true when this load should take the schema's hold
   * on the model (pass no `hold` option), false when the schema already holds it (pass
   * `hold: false`). After a true, call `dropSchemaHold` if the load returns no model.
   */
  static takeSchemaHold(modelFileId: string | undefined): boolean {
    if (!modelFileId || this.schemaHeldModelIds.has(modelFileId)) return false
    this.schemaHeldModelIds.add(modelFileId)
    return true
  }

  /** @internal The load `takeSchemaHold` approved found no model: there is no hold to release. */
  static dropSchemaHold(modelFileId: string): void {
    this.schemaHeldModelIds.delete(modelFileId)
  }

  /** @internal A Schema's last unload: releases its hold on each of its models. */
  static releaseSchemaHolds(schemaName: string): void {
    for (const modelFileId of [...this.schemaHeldModelIds]) {
      const model = this.peek(modelFileId)
      if (!model) {
        this.schemaHeldModelIds.delete(modelFileId)
        continue
      }
      if (model._getSnapshotContext().schemaName !== schemaName) continue
      this.schemaHeldModelIds.delete(modelFileId)
      model.unload()
    }
  }

  /**
   * The cached Model with this modelFileId, without taking a hold. For SDK code that reads the
   * model and doesn't hand it to a caller; callers that keep it use `getById`, `find` or `create`.
   */
  static peek(modelFileId: string): Model | undefined {
    return this.cache.peek(modelFileId)
  }

  /**
   * Get Model instance by name (O(1) lookup via name→ID mapping). Takes a hold on the instance;
   * release it with `unload()`.
   *
   * @param modelName - The name of the model
   * @param schemaName - The schema name (optional, will query DB if not provided)
   * @returns The Model instance if found, undefined otherwise
   */
  static getByName(modelName: string, schemaName?: string): Model | undefined {
    const model = this.peekByName(modelName, schemaName)
    return model && this.cache.holdInstance(model) ? model : undefined
  }

  /**
   * `getByName` without taking a hold. Without `schemaName` it searches every cached schema and
   * throws AmbiguousModelError when models from several schemas share the name; callers that know
   * the schema or model id should use Model.resolve() instead.
   */
  static peekByName(modelName: string, schemaName?: string): Model | undefined {
    if (schemaName) return this.cache.peek(modelKey(schemaName, modelName))
    return this._getUniqueCachedModel(modelName, (cachedModelName) => cachedModelName === modelName)
  }

  /**
   * The one cached Model whose name matches (no hold taken), or AmbiguousModelError if models from
   * several schemas do.
   */
  private static _getUniqueCachedModel(
    label: string,
    matches: (cachedModelName: string) => boolean,
  ): Model | undefined {
    const matches_ = this.cache.instances((model) => {
      const name = model._getSnapshotContext().modelName
      return !!name && matches(name)
    })
    const schemaNames = new Set(matches_.map((model) => model._getSnapshotContext().schemaName))
    if (matches_.length > 1 && schemaNames.size > 1) {
      throw new AmbiguousModelError(label, [...schemaNames])
    }
    return matches_[0]
  }

  /**
   * Resolve a cached Model from the most specific scope available: modelFileId (Model.id), then
   * schemaName + modelName, then modelName alone. Takes no hold.
   */
  static resolve(
    modelName: string | undefined,
    scope: { modelFileId?: string | null; schemaName?: string | null } = {},
  ): Model | undefined {
    if (scope.modelFileId) {
      const byId = this.peek(scope.modelFileId)
      if (byId) return byId
    }
    if (!modelName) return undefined
    if (scope.schemaName) {
      const bySchema = this.peekByName(modelName, scope.schemaName)
      if (bySchema) return bySchema
    }
    return this.peekByName(modelName)
  }

  /**
   * Find Model by modelType (an EAS model name, as seeds.type stores it). Matched as ADR 0008
   * matches EAS names: `new_model` finds "New model", and `htmlpage` (an older SDK's name) finds
   * "HTMLPage", unless HTMLPage's nameMatch (ADR 0009) is `exact`. Only the tightest matching tier
   * counts; matches in several schemas are ambiguous. Takes no hold.
   */
  static findByModelType(modelType: string): Model | undefined {
    if (!modelType) return undefined
    const cachedNames = this.cache.instances().map((model) => model._getSnapshotContext().modelName).filter(Boolean)
    // Each name at its nameMatch level (ADR 0009), as last loaded.
    const levels = currentNameMatchLevels()
    const best = localNamesInBestMatchTier(modelType, cachedNames, { level: (name) => levels.model(name) })
    return this._getUniqueCachedModel(modelType, (cachedModelName) => best.has(cachedModelName))
  }

  /**
   * Get all Model instances for a schema from cache only (synchronous). Takes no holds.
   * Includes models created at runtime via Model.create() that may not yet be in schema context.
   */
  static getCachedInstancesForSchema(schemaName: string): Model[] {
    return this.cache.instances((model) => model._getSnapshotContext().schemaName === schemaName)
  }

  /**
   * Async Model.resolve(): exact cache hit by modelFileId or schemaName+modelName, else the DB row for
   * that scope (instantiating the Model), and only then the name-only fallback. Takes no hold.
   */
  static async resolveAsync(
    modelName: string | undefined,
    scope: { modelFileId?: string | null; schemaName?: string | null } = {},
  ): Promise<Model | undefined> {
    if (scope.modelFileId) {
      const byId = this.peek(scope.modelFileId)
      if (byId) return byId
    }
    if (modelName && scope.schemaName) {
      const bySchema = this.peekByName(modelName, scope.schemaName)
      if (bySchema) return bySchema
    }
    if (scope.modelFileId || scope.schemaName) {
      const db = BaseDb.getAppDb()
      if (db) {
        const since = evictionLog.now()
        try {
          const { resolveModelRecord, getModelSchemaName } = await import('../db/read/resolveModelRecord')
          const resolved = scope.modelFileId
            ? await resolveModelRecord(undefined, { modelFileId: scope.modelFileId }, db)
            : await resolveModelRecord(modelName, { schemaName: scope.schemaName, strict: true }, db)
          const record = resolved && {
            modelFileId: resolved.schemaFileId,
            modelName: resolved.name,
            schemaName: await getModelSchemaName(resolved.id, db),
          }
          if (record?.modelName && record.schemaName && record.modelFileId) {
            // Its schema was evicted, or it was destroyed, while we read the row: don't bring it back.
            if (evictionLog.evictedSince([`schema:${record.schemaName}`, `model:${record.modelFileId}`], since)) return undefined
            return this.create(record.modelName, record.schemaName, { id: record.modelFileId, hold: false })
          }
        } catch (error) {
          logger(`Model.resolveAsync: scoped lookup failed for "${modelName}": ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return modelName ? this.getByNameAsync(modelName, undefined, { hold: false }) : undefined
  }

  /**
   * Get Model instance by name, querying database if not in cache
   * This is an async version that can query the database when schemaName is not provided
   * 
   * @param modelName - The name of the model
   * @param schemaName - Optional schema name (will query DB if not provided)
   * @returns The Model instance if found, undefined otherwise. Takes a hold unless `hold: false`.
   */
  static async getByNameAsync(
    modelName: string,
    schemaName?: string,
    options?: {
      /**
       * evictionLog.now() from when the caller's work started. An eviction of the model or its
       * schema since then makes this return undefined instead of re-creating the model. Defaults to now.
       */
      since?: number
      /** @internal `hold: false` as for `create` */
      hold?: false
    },
  ): Promise<Model | undefined> {
    // First try cache
    const cached =
      options?.hold === false ? this.peekByName(modelName, schemaName) : this.getByName(modelName, schemaName)
    if (cached) {
      return cached
    }

    // Not cached: the DB row for this name in that schema, or for the name alone (which throws
    // AmbiguousModelError when several schemas define it)
    const db = BaseDb.getAppDb()
    if (!db) {
      return undefined
    }
    const since = options?.since ?? evictionLog.now()
    try {
      const { resolveModelRecord, getModelSchemaName } = await import('../db/read/resolveModelRecord')
      const resolved = await resolveModelRecord(modelName, schemaName ? { schemaName, strict: true } : {}, db)
      if (!resolved?.schemaFileId) {
        return undefined
      }
      const recordSchemaName = schemaName ?? (await getModelSchemaName(resolved.id, db))
      if (!resolved.name || !recordSchemaName) {
        return undefined
      }
      // Its schema was evicted, or it was destroyed, while we read the row: don't bring it back.
      if (evictionLog.evictedSince([`schema:${recordSchemaName}`, `model:${resolved.schemaFileId}`], since)) {
        return undefined
      }

      // Create model instance (will be cached)
      return this.create(resolved.name, recordSchemaName, {
        id: resolved.schemaFileId, // id is now the schemaFileId (string)
        ...(options?.hold === false && { hold: false as const }),
      })
    } catch (error) {
      if (error instanceof AmbiguousModelError) throw error
      logger(`Model.getByNameAsync: Error looking up model by name "${modelName}": ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /**
   * Create or get Model instance by modelFileId
   * Checks cache first, then database if not found
   * 
   * @param modelFileId - The model file ID to look up
   * @returns The Model instance if found, undefined otherwise
   */
  static async createById(
    modelFileId: string,
    options?: {
      /**
       * evictionLog.now() from when the caller's work started (e.g. a Schema load that read the model
       * ids). An eviction of the model or its schema since then makes this return undefined instead
       * of re-creating the model. Defaults to now.
       */
      since?: number
      /** @internal `hold: false` as for `create` */
      hold?: false
    },
  ): Promise<Model | undefined> {
    if (!modelFileId) {
      return undefined
    }

    // Step 1: Check cache first (fast path)
    const cached = options?.hold === false ? this.peek(modelFileId) : this.getById(modelFileId)
    if (cached) {
      logger(`Model.createById: Found instance in cache for ID "${modelFileId}"`)
      return cached
    }

    // Step 2: Query database to get modelName and schemaName
    const db = BaseDb.getAppDb()
    if (!db) {
      logger(`Model.createById: Database not available for ID "${modelFileId}"`)
      return undefined
    }
    const since = options?.since ?? evictionLog.now()

    try {

      // Query model by schemaFileId and join to get schema name
      const modelRecords = await db
        .select({
          modelId: modelsTable.id,
          modelName: modelsTable.name,
          schemaName: schemasTable.name,
        })
        .from(modelsTable)
        .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
        .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)

      if (modelRecords.length === 0) {
        logger(`Model.createById: Model not found in database for ID "${modelFileId}"`)
        return undefined
      }

      const { modelName, schemaName } = modelRecords[0]
      if (!modelName || !schemaName) {
        logger(`Model.createById: Missing modelName or schemaName for ID "${modelFileId}"`)
        return undefined
      }
      // Its schema was evicted while we read the row (e.g. a Schema live query in flight during
      // Schema.destroy or test cleanup): don't bring the model back.
      // or the model was destroyed (destroy() leaves the cache before it deletes the rows)
      if (evictionLog.evictedSince([`schema:${schemaName}`, `model:${modelFileId}`], since)) {
        logger(`Model.createById: "${modelFileId}" or its schema "${schemaName}" was evicted during the lookup`)
        return undefined
      }

      // Step 3: Create model using existing create method (which will handle caching)
      logger(`Model.createById: Creating model "${modelName}" in schema "${schemaName}" from ID "${modelFileId}"`)
      return this.create(modelName, schemaName, {
        id: modelFileId, // id is now the schemaFileId (string)
        ...(options?.hold === false && { hold: false as const }),
      })
    } catch (error) {
      logger(`Model.createById: Error looking up model by ID "${modelFileId}": ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /**
   * Find Model instance by modelFileId, modelName/schemaName, or both
   * Waits for the model to be fully loaded (idle state) by default
   * @param options - Find options including lookup parameters and wait configuration
   * @returns Model instance if found, undefined otherwise
   */
  static async find({
    modelFileId,
    modelName,
    schemaName,
    waitForReady = true,
    readyTimeout = DEFAULT_READY_TIMEOUT_MS,
  }: {
    modelFileId?: string
    modelName?: string
    schemaName?: string
    waitForReady?: boolean
    readyTimeout?: number
  }): Promise<Model | undefined> {
    const model = modelFileId
      ? (Model.getById(modelFileId) ?? (await Model.createById(modelFileId)))
      : modelName
        ? (Model.getByName(modelName, schemaName) ?? (await Model.getByNameAsync(modelName, schemaName)))
        : undefined
    if (model && waitForReady) await waitForEntityReady(model, { timeout: readyTimeout })
    return model
  }

  /**
   * Get all Model instances for a schema by schemaFileId or schemaName
   * Queries database for all models with the given schemaId/schemaName and returns Model instances
   * 
   * @param schemaIdentifier - The schema file ID or schema name to get models for
   * @returns Array of Model instances for the schema
   */
  static async createBySchemaId(schemaIdentifier: string): Promise<Model[]> {
    if (!schemaIdentifier) {
      return []
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      logger(`Model.createBySchemaId: Database not available for schema "${schemaIdentifier}"`)
      return []
    }
    const since = evictionLog.now()

    try {

      // Query all models for this schema - support both schemaFileId and schema name
      const modelRecords = await db
        .select({
          modelFileId: modelsTable.schemaFileId,
          modelName: modelsTable.name,
          schemaName: schemasTable.name,
        })
        .from(schemasTable)
        .innerJoin(modelSchemas, eq(schemasTable.id, modelSchemas.schemaId))
        .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
        .where(
          or(
            eq(schemasTable.schemaFileId, schemaIdentifier),
            eq(schemasTable.name, schemaIdentifier)
          )
        )

      if (modelRecords.length === 0) {
        logger(`Model.createBySchemaId: No models found in database for schema "${schemaIdentifier}"`)
        return []
      }

      // Create Model instances for each model (create() handles caching)
      const modelInstances: Model[] = []
      for (const record of modelRecords) {
        if (!record.modelName || !record.schemaName || !record.modelFileId) {
          continue
        }
        // Its schema was evicted, or the model destroyed, while we read the rows: don't bring it back.
        if (evictionLog.evictedSince([`schema:${record.schemaName}`, `model:${record.modelFileId}`], since)) {
          continue
        }

        // Check cache first
        const cached = this.getById(record.modelFileId)
        if (cached) {
          modelInstances.push(cached)
        } else {
          // Create model instance (will be cached)
          const model = this.create(record.modelName, record.schemaName, {
            id: record.modelFileId, // id is now the schemaFileId (string)
            waitForReady: false,
          }) as Model
          modelInstances.push(model)
        }
      }

      logger(`Model.createBySchemaId: Found ${modelInstances.length} models for schema "${schemaIdentifier}"`)
      return modelInstances
    } catch (error) {
      logger(`Model.createBySchemaId: Error looking up models for schema "${schemaIdentifier}": ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /**
   * Get all Model instances, optionally filtered by schema.
   * When DB is available, loads from DB via getModelsData; otherwise returns from cache.
   * With waitForReady, waits for each model to be ready (idle, with any properties from Model.create
   * created) and leaves out models that error or time out. Takes no holds: a caller that keeps a
   * model uses `Model.find` or `Model.create`.
   */
  static async all(
    schemaName?: string,
    options?: { waitForReady?: boolean; readyTimeout?: number },
  ): Promise<Model[]> {
    const { waitForReady = false, readyTimeout = DEFAULT_READY_TIMEOUT_MS } = options ?? {}
    const appDb = BaseDb.getAppDb()

    const inSchema = (model: Model) => !schemaName || model._getSnapshotContext().schemaName === schemaName
    if (!appDb) return this.cache.instances(inSchema)

    const rows = await getModelsData(schemaName)
    const instances: Model[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      // A model can appear more than once (e.g. duplicate model_schemas links); return it once.
      if (row.schemaFileId && !seen.has(row.schemaFileId)) {
        const instance = await this.createById(row.schemaFileId, { hold: false })
        if (instance && !seen.has(instance.id ?? row.schemaFileId)) {
          instances.push(instance)
          seen.add(instance.id ?? row.schemaFileId)
        }
      }
    }

    // Cached models of this schema too (a just-created model's row may not be readable yet)
    if (schemaName) {
      for (const instance of this.cache.instances(inSchema)) {
        const id = instance._getSnapshotContext().id
        if (id && !seen.has(id)) {
          instances.push(instance)
          seen.add(id)
        }
      }
    }

    if (waitForReady && instances.length > 0) {
      // Leave out models that errored or didn't get ready in time. Don't re-read their state afterwards:
      // a ready model can already be validating again, and it still belongs in the result.
      const ready = await Promise.all(
        instances.map((m) =>
          waitForEntityReady(m, { timeout: readyTimeout }).then(
            () => true,
            (error) => {
              logger(`Model.all: leaving out a model that isn't ready: ${error instanceof Error ? error.message : String(error)}`)
              return false
            },
          ),
        ),
      )
      return instances.filter((_, i) => ready[i])
    }

    return instances
  }

  getService(): ModelService {
    return this._service
  }

  private _getSnapshot(): ModelSnapshot {
    return this._service.getSnapshot() as ModelSnapshot
  }

  private _getSnapshotContext(): ModelMachineContext {
    return this._getSnapshot().context
  }

  /**
   * Check for conflicts between actor context and database
   * @returns ConflictResult indicating if a conflict exists
   */
  private async _checkForConflicts(): Promise<ConflictResult> {
    const context = this._getSnapshotContext()
    
    // If we don't have load metadata, can't check for conflicts
    if (!context._dbUpdatedAt || !context.id) {
      return { hasConflict: false }
    }
    
    try {
      const db = BaseDb.getAppDb()
      if (!db) {
        return { hasConflict: false } // Can't check without DB
      }
      
      // Get current DB record by id (schemaFileId) - most reliable lookup
      const dbModels = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, context.id)) // id is now the schemaFileId (string)
        .limit(1)
      
      if (dbModels.length === 0) {
        return { hasConflict: false } // No DB record, no conflict
      }
      
      
      // Check if DB was updated after we loaded
      // Note: models table doesn't have updatedAt, so we can't do timestamp comparison
      // For now, we'll just check if the record exists and matches
      // In the future, if models table gets updatedAt, we can compare timestamps
      return { hasConflict: false }
    } catch (error) {
      logger(`Error checking for conflicts: ${error instanceof Error ? error.message : String(error)}`)
      return { hasConflict: false } // On error, assume no conflict to allow save
    }
  }

  /**
   * Saves model name changes to the database immediately (draft save)
   * This is called when modelName is changed to persist the change immediately
   * @param oldName - The old model name (if name changed)
   * @param newName - The new model name
   */
  private async _saveDraftToDb(oldName?: string, newName?: string): Promise<void> {
    saveDraftLogger(`_saveDraftToDb called for model (oldName: "${oldName}", newName: "${newName}")`)
    
    // Not during client init in the browser: models are being loaded from files then, not edited
    if (typeof window !== 'undefined' && !isClientReady()) {
      saveDraftLogger(`Client not ready, skipping save (oldName: "${oldName}", newName: "${newName}")`)
      return
    }

    saveDraftLogger(`Client is initialized, proceeding with save (oldName: "${oldName}", newName: "${newName}")`)

    const context = this._getSnapshotContext()
    const modelFileId = context.id || '' // id is now the schemaFileId (string)
    const modelName = newName || context.modelName || oldName || ''
    // Use modelFileId as the key if available, otherwise use schemaName:modelName
    const saveKey = modelFileId || `${context.schemaName}:${modelName}`

    // A save started while another for this model runs waits for it, so renames land in order.
    // Errors reach the caller (trackDraftSave records them for lastSaveError).
    await queueDraftSave(saveKey, async () => {
      const conflictCheck = await this._checkForConflicts()
      if (conflictCheck.hasConflict) {
        const errorMessage = conflictCheck.message || 'Database was updated externally. Please reload the model and try again.'
        saveDraftLogger(`CONFLICT DETECTED: ${errorMessage}`)
        throw new ConflictError(errorMessage, conflictCheck)
      }

      if (oldName && newName && oldName !== newName) {
        saveDraftLogger(`Renaming model from "${oldName}" to "${newName}"`)
        await renameModelInDb(oldName, newName, context.schemaName)
      } else {
        // Only modelName is saved immediately
        saveDraftLogger(`No name change detected, skipping save (modelName: "${modelName}")`)
      }

      // Conflict detection metadata (models has no updatedAt column)
      this._service.send({
        type: 'updateContext',
        _dbUpdatedAt: Date.now(),
      })
    })
  }

  /** Resolves once `status` is `ready`; rejects when the load failed or `timeout` ms pass. */
  waitForReady(options?: { timeout?: number }): Promise<void> {
    return waitForEntityReady(this, options)
  }

  /** `loading` until the model is loaded (and any properties passed to create exist), then `ready` or `error`. */
  get status() {
    return entityStatus(this)
  }

  /** The error from the last draft save a rename started, or undefined once a later one succeeds. */
  get lastSaveError(): Error | undefined {
    return getDraftSaveError(this._service)
  }

  get validationErrors() {
    return this._getSnapshotContext()._validationErrors || []
  }

  get isValid() {
    const errors = this.validationErrors
    return errors.length === 0
  }

  get isEdited() {
    const context = this._getSnapshotContext()
    // First check in-memory state
    if (context._isEdited !== undefined) {
      return context._isEdited
    }
    // Fall back to reading from database if we have _dbId
    if (context._dbId) {
      // Load from database asynchronously (fire-and-forget for now)
      // For synchronous getter, we'll need to cache it or make it async
      // For now, return false if not in context
      return false
    }
    return false
  }

  get id() {
    return this._getSnapshotContext().id // id is now the schemaFileId (string)
  }

  get name() {
    return this._getSnapshotContext().modelName
  }

  /**
   * Returns ModelProperty instances for this model
   * This is a computed property that reads from the service context
   * Note: This is NOT reactive - use useModelProperties() hook for reactivity
   */
  get properties(): any[] {
    const snapshot = this._service.getSnapshot()
    const context = snapshot.context
    
    // Get property IDs from liveQuery (stored in context, not instanceState)
    const liveQueryIds = context._liveQueryPropertyIds || []
    // Get _dbId from context for pending writes lookup
    const dbId: number | undefined = context._dbId // _dbId is the database integer ID
    // Get pending property IDs (synchronous - uses static Map)
    // Lazy import ModelProperty to avoid circular dependency
    const ModelProperty = getModelProperty()
    if (!ModelProperty) {
      // If ModelProperty is not yet loaded, return empty array
      // It will be available on subsequent accesses after the async import completes
      return []
    }
    const pendingIds = dbId ? ModelProperty.getPendingPropertyIds(dbId) : []
    
    // Combine and deduplicate
    const allPropertyIds = [...new Set([...liveQueryIds, ...pendingIds])]
    
    // Get ModelProperty instances from static cache (synchronous)
    const propertyInstances: any[] = []
    for (const propertyFileId of allPropertyIds) {
      const property = ModelProperty.getById(propertyFileId)
      if (property) {
        propertyInstances.push(property)
      }
      // Note: Cannot create properties asynchronously in this synchronous getter
      // Properties will be created elsewhere when needed
    }
    
    // Return a new array reference (snapshot at time of access)
    return [...propertyInstances]
  }

  /**
   * Validate the model
   * @returns Validation result
   */
  async validate(): Promise<{ isValid: boolean; errors: any[] }> {
    this._service.send({ type: 'validateModel' })
    // Settles when validating ends; after 15 s (longer than the validator's own timeout) the errors so far
    await waitFor(this._service, (snapshot) => snapshot.value !== 'validating', { timeout: 15_000 }).catch(() => {})
    const errors = this._getSnapshotContext()._validationErrors || []
    return { isValid: errors.length === 0, errors }
  }

  /**
   * Create a new item instance from this model
   * Automatically injects the model name, so you don't need to pass it explicitly.
   * 
   * @example
   * const Post = Model.create('Post', schema)
   * const post = await Post.create({ title: 'My Post', content: '...' })
   * 
   * @param values - Item property values (modelName is automatically injected)
   * @returns The created item instance
   */
  async create(values: Partial<ItemData> & Record<string, any>): Promise<Item<any>> {
    if (!this.modelName) {
      throw new Error('Cannot create item: model name is not set on this Model instance')
    }
    
    const item = await Item.create({
      modelName: this.modelName,
      schemaName: this.schemaName,
      modelInstance: this,
      ...values,
    } as Partial<ItemData> & { modelName: string; schemaName?: string; modelInstance?: Model } & Record<string, any>)
    return item
  }


  /**
   * Reload model from database
   * This refreshes the actor context with the latest data from the database
   */
  async reload(): Promise<void> {
    logger(`Reloading model ${this.modelName} from database`)
    await runEntityLoad(this, () => Model.load(this))
    if (this.status === 'error') throw new Error('Failed to reload model from database')
  }

  /**
   * Force-evict every cached Model belonging to a schema, ignoring refCounts, and stop their services.
   * Used by Schema.destroy(): once the DB rows are gone, cached instances would keep a dangling _dbId
   * and be handed back by Model.create/Model.all after the schema is re-imported.
   * @returns names of the evicted models (so callers can evict their ModelProperty instances)
   */
  static evictForSchema(schemaName: string): string[] {
    // Work already running for this schema's models must not re-cache them when it finishes
    evictionLog.evict([`schema:${schemaName}`])()
    const evicted = evictEntities(this.cache, (model) => model._getSnapshotContext().schemaName === schemaName)
    const evictedNames: string[] = []
    for (const model of evicted) {
      const { id, modelName } = model._getSnapshotContext()
      if (id) this.schemaHeldModelIds.delete(id)
      if (modelName) evictedNames.push(modelName)
    }
    return evictedNames
  }

  /** Release this caller's hold. The model is stopped and leaves the cache with its last hold. */
  unload(): void {
    releaseEntity(this, Model.cache)
  }

  /**
   * Destroy the model: delete its rows (model, its properties, its schema links), remove it from its
   * Schema's context, and stop it and its cached ModelProperty instances.
   */
  async destroy(): Promise<void> {
    const context = this._getSnapshotContext()
    const modelFileId = context.id
    const modelName = context.modelName
    const schemaName = context.schemaName
    const dbId = context._dbId

    // A lookup by id already reading the row must not re-cache the model
    const finishEviction = evictionLog.evict(modelFileId ? [`model:${modelFileId}`] : [])
    if (modelFileId) Model.schemaHeldModelIds.delete(modelFileId)

    try {
      await destroyEntity(this, Model.cache, async () => {
        const db = BaseDb.getAppDb()
        if (db && modelFileId) {
          const [modelRecord] = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.schemaFileId, modelFileId))
            .limit(1)
          if (modelRecord) {
            const modelId: number = modelRecord.id
            const { detachModelRows } = await import('@/helpers/entity/detachRowsBeforeDelete')
            const { inDefinitionsTransaction } = await import('@/db/write/definitions')
            // The model's rows go together or not at all
            await inDefinitionsTransaction(async (tx) => {
              await detachModelRows(tx, [modelId])
              await tx.delete(modelSchemas).where(eq(modelSchemas.modelId, modelId))
              await tx.delete(propertiesTable).where(eq(propertiesTable.modelId, modelId))
              await tx.delete(modelsTable).where(eq(modelsTable.id, modelId))
            })
          }
        }

        // Its properties' rows are gone with it: their instances go too, whoever holds them
        await modelPropertyImportPromise
        getModelProperty()?.evictForModel({ modelName, schemaName, modelId: dbId })

        if (schemaName && modelName) {
          // Imported here, not at module load: Model and Schema import each other.
          const { Schema } = await import('@/Schema/Schema')
          const schema = await Schema.find({ schemaName, waitForReady: false, hold: false })
          const schemaContext = schema?.getService().getSnapshot().context
          if (schema && schemaContext?.models?.[modelName]) {
            const updatedModels = { ...schemaContext.models }
            delete updatedModels[modelName]
            schema.getService().send({ type: 'updateContext', models: updatedModels })
            schema.getService().send({ type: 'markAsDraft', propertyKey: `model:${modelName}` })
          }
        }
      })
    } finally {
      finishEviction()
    }
  }

  /**
   * Set up liveQuery subscription to watch for property changes in the database
   * This enables cross-instance synchronization (e.g., changes in other tabs/windows)
   */
  private _setupLiveQuerySubscription(): void {
    setupEntityLiveQuery(this, {
      getEntityId: async (model) => {
        const context = model._getSnapshotContext()
        let dbId = context._dbId // _dbId is the database integer ID
        const modelName = context.modelName
        
        if (!modelName) {
          return undefined
        }
        
        // If we don't have _dbId yet, try to find it in the database
        if (!dbId) {
          try {
            const db = BaseDb.getAppDb()
            if (!db) {
              return undefined
            }

            // Model names are only unique per schema: find this model's row by its id (schemaFileId).
            const { resolveModelRecord } = await import('../db/read/resolveModelRecord')
            const modelRecord = await resolveModelRecord(
              modelName,
              { modelFileId: context.id, schemaName: context.schemaName },
              db,
            )

            if (!modelRecord?.id) {
              return undefined
            }
            // Until this model's own row is written, the lookup falls back to the name and can find a
            // same-named model in another schema. Taking that row would load its properties into this
            // model; wait for the row with this model's id instead (the caller retries).
            if (context.id && modelRecord.schemaFileId !== context.id) {
              return undefined
            }

            dbId = modelRecord.id

            // Update context with _dbId (unless the model was stopped while the lookup ran)
            if (isActorStopped(model._service)) return undefined
            model._service.send({
              type: 'updateContext',
              _dbId: dbId,
            })
          } catch (error) {
            logger(`[Model._setupLiveQuerySubscription] Error finding model: ${error}`)
            return undefined
          }
        }
        
        return dbId
      },
      buildQuery: async (modelId) => {
        return BaseDb.liveQuery<{ id: number; name: string; dataType: string; modelId: number; refModelId: number | null; refValueType: string | null; schemaFileId: string | null }>(
          (sql: any) => sql`
            SELECT id, name, data_type as dataType, model_id as modelId, ref_model_id as refModelId, ref_value_type as refValueType, schema_file_id as schemaFileId
            FROM properties
            WHERE model_id = ${modelId}
          `
        )
      },
      extractEntityIds: (rows) => rows
        .map(row => row.schemaFileId)
        .filter((id): id is string => id !== null && id !== undefined),
      updateContext: (model, ids) => {
        model._service.send({
          type: 'updateContext',
          _liveQueryPropertyIds: ids, // Store in service context for reactivity
          _propertiesUpdated: Date.now(), // Internal field for tracking
        })
      },
      createChildInstances: async (ids) => {
        await modelPropertyImportPromise
        const ModelProperty = getModelProperty()
        if (!ModelProperty) {
          logger('[Model._setupLiveQuerySubscription] ModelProperty not yet loaded')
          return
        }
        const createPromises = ids.map(async (propertyFileId: string) => {
          try {
            await ModelProperty.createById(propertyFileId)
          } catch (error) {
            logger(`[Model._setupLiveQuerySubscription] Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
          }
        })
        await Promise.all(createPromises)
      },
      queryInitialData: async (modelId) => {
        const db = BaseDb.getAppDb()
        if (!db) {
          return []
        }

        const initialProperties = await db
          .select({ schemaFileId: propertiesTable.schemaFileId })
          .from(propertiesTable)
          .where(eq(propertiesTable.modelId, typeof modelId === 'string' ? parseInt(modelId, 10) : modelId))

        return initialProperties.map((row: { schemaFileId: string | null }) => ({
          schemaFileId: row.schemaFileId,
        }))
      },
      // The model writes its row while itself idle; wait for that write to end.
      canRetryEntityId: (model) => !modelWritesInFlight.has(model.getService()),
      loggerName: 'seedSdk:model:liveQuery',
    })
  }

  /**
   * Refresh property IDs from database (useful in Node.js where liveQuery isn't available)
   */
  private async _refreshPropertiesFromDb(): Promise<void> {
    const snapshot = this._service.getSnapshot()
    const dbId = snapshot.context._dbId // _dbId is the database integer ID
    const modelName = snapshot.context.modelName

    if (!dbId || !modelName) {
      return
    }

    try {
      const db = BaseDb.getAppDb()
      if (!db) {
        return
      }

      const propertyRows = await db
        .select({ schemaFileId: propertiesTable.schemaFileId })
        .from(propertiesTable)
        .where(eq(propertiesTable.modelId, dbId)) // Use _dbId (database integer ID)

      // Stopped while querying: don't re-cache ModelProperty instances for an evicted/unloaded model
      if (isActorStopped(this._service)) return

      const propertyIds = propertyRows
        .map((row: { schemaFileId: string | null }) => row.schemaFileId)
        .filter((id: string | null): id is string => id !== null && id !== undefined)

      // CRITICAL: Create ModelProperty instances BEFORE updating context
      // This ensures they're in the cache when the properties getter is called
      if (propertyIds.length > 0) {
        try {
          await modelPropertyImportPromise
          const ModelProperty = getModelProperty()
          if (!ModelProperty) {
            logger('[Model._refreshPropertiesFromDb] ModelProperty not yet loaded')
          } else {
          const createPromises = propertyIds.map(async (propertyFileId: string) => {
            try {
              const property = await ModelProperty.createById(propertyFileId)
              if (property) {
                logger(`[Model._refreshPropertiesFromDb] Created/cached ModelProperty instance for propertyFileId "${propertyFileId}"`)
              } else {
                logger(`[Model._refreshPropertiesFromDb] ModelProperty.createById returned undefined for propertyFileId "${propertyFileId}"`)
              }
            } catch (error) {
              logger(`[Model._refreshPropertiesFromDb] Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
            }
          })
          await Promise.all(createPromises)
          }
        } catch (error) {
          logger(`[Model._refreshPropertiesFromDb] Error importing ModelProperty or creating instances: ${error}`)
        }
      }

      // Update context with refreshed property IDs AFTER creating instances (the awaits above can
      // outlive the instance)
      if (isActorStopped(this._service)) return
      this._service.send({
        type: 'updateContext',
        _liveQueryPropertyIds: propertyIds,
        _propertiesUpdated: Date.now(),
      })
    } catch (error) {
      logger(`[Model._refreshPropertiesFromDb] Error refreshing properties: ${error}`)
    }
  }

  /**
   * Public method to refresh properties from database
   */
  async refreshProperties(): Promise<void> {
    await this._refreshPropertiesFromDb()
  }

  /**
   * Refresh the property ids of every cached Model whose DB row is `dbId`. Called when a property
   * write for that model finishes: until then `properties` includes it as a pending write, and in Node
   * (no reactive liveQuery) nothing else adds it to `_liveQueryPropertyIds`.
   */
  static async refreshPropertiesForDbId(dbId: number): Promise<void> {
    for (const instance of this.cache.instances((model) => model._getSnapshotContext()._dbId === dbId)) {
      await instance._refreshPropertiesFromDb()
    }
  }

}

