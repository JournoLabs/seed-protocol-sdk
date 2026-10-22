import { whenDbReady } from '@/client/readiness'
import {
  appState,
  models as modelsTable,
  NewModelRecord,
  NewPropertyRecord,
  pendingWrites,
  properties,
  PropertyType,
  seeds,
} from '@/seedSchema'
import { ModelDefinitions } from '@/types'
import { easName } from '@seedprotocol/eas'
import { and, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { BaseDb } from '@/db/Db/BaseDb'
import { SchemaType, schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine'
import { refreshCachedProperties } from './cachedPropertyRefresh'
// Dynamic import to break circular dependency: Model -> ... -> helpers/db -> ModelProperty -> ... -> Model
// import { ModelProperty } from '@/ModelProperty/ModelProperty'
import debug from 'debug'
import { clearNameMatchLevels } from '@/db/read/nameMatchLevels'
import {
  resolveModelRecord,
  resolveModelRecordByNameOrType,
  type ModelScope,
} from '@/db/read/resolveModelRecord'
import { normalizeAddressConfig, type NormalizedAddressConfig } from '@/helpers/addresses'
import { normalizePropertyRecordSchema } from '@/helpers/property'
import { propertyDefinitionFromRow } from '@/helpers/propertyDefinition'
import {
  findOrCreateModelRow,
  inDefinitionsTransaction,
  linkModelToSchemaRow,
  renameModelRow,
  upsertModelRow,
  upsertPropertyRow,
  upsertSchemaRow,
} from '@/db/write/definitions'

const logger = debug('seedSdk:helpers:db')

/**
 * Posts one message and closes the channel. A message already posted is still delivered after its
 * sender closes, and an open BroadcastChannel keeps a Node process alive (each was a MessagePort
 * handle that stopped scripts exiting).
 */
const postBroadcast = (channelName: string, message: unknown): void => {
  const channel = new BroadcastChannel(channelName)
  try {
    channel.postMessage(message)
  } finally {
    channel.close()
  }
}

type PropertyStorageColumns = Pick<NewPropertyRecord, 'storageType' | 'localStorageDir' | 'filenameSuffix'>

/**
 * The `properties` storage columns for a property definition, in either the internal shape
 * (`storageType`, `localStorageDir`, `filenameSuffix`) or the schema-file shape
 * (`storage: { type, path, extension }`). All null when the definition has no storage config.
 */
export function propertyStorageColumns(def: unknown): PropertyStorageColumns {
  const normalized = normalizePropertyRecordSchema((def ?? {}) as Record<string, any>)
  return {
    storageType: normalized.storageType ?? null,
    localStorageDir: normalized.localStorageDir ?? null,
    filenameSuffix: normalized.filenameSuffix ?? null,
  }
}

/** True when the definition carries any storage setting (so writing its columns can't wipe them by omission). */
const hasStorageSettings = (columns: PropertyStorageColumns): boolean =>
  columns.storageType != null || columns.localStorageDir != null || columns.filenameSuffix != null

/**
 * A model's ItemStorage properties as stored in `properties` (storage_type 'ItemStorage'), with
 * their storage path and extension. Reads the table, not ModelProperty instances, so it doesn't
 * depend on whether (or from where) the model's property instances have loaded.
 */
export async function getItemStoragePropertiesForModel(
  modelNameOrType: string,
  scope: ModelScope = {},
): Promise<Array<{ id: number; name: string; localStorageDir: string | null; filenameSuffix: string | null }>> {
  const db = BaseDb.getAppDb()
  if (!db || !modelNameOrType) return []
  const modelRecord = await resolveModelRecordByNameOrType(modelNameOrType, scope, db)
  if (!modelRecord) return []
  return db
    .select({
      id: properties.id,
      name: properties.name,
      localStorageDir: properties.localStorageDir,
      filenameSuffix: properties.filenameSuffix,
    })
    .from(properties)
    .where(and(eq(properties.modelId, modelRecord.id), eq(properties.storageType, 'ItemStorage')))
}

/**
 * Moves a renamed property's pending outbox edits (ADR 0019) to its new name, so they apply as the
 * property's. Its metadata rows need no move: readers match them by property_id (decision D4).
 * Returns the number of ops renamed.
 */
export async function renamePendingWritesForProperty(
  modelName: string,
  oldPropertyName: string,
  newPropertyName: string,
): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) return 0
  const renamed = await db
    .update(pendingWrites)
    .set({ propertyName: newPropertyName })
    .where(
      and(
        eq(pendingWrites.propertyName, oldPropertyName),
        eq(pendingWrites.status, 'pending'),
        inArray(
          pendingWrites.seedLocalId,
          db.select({ localId: seeds.localId }).from(seeds).where(eq(seeds.type, easName(modelName))),
        ),
      ),
    )
    .returning({ opId: pendingWrites.opId })
  return renamed.length
}

type AppDb = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/** Tells React's useSchemas a schemas row was inserted (its live query may not re-run). */
export const broadcastSchemasInvalidate = (): void => {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    postBroadcast('seed-schemas-invalidate', {})
  } catch (_) {}
}

/** Tells React's useModels a model was linked to a schema (its live query may not re-run). */
const broadcastModelsInvalidate = (schema: { name?: string | null; schemaFileId?: string | null }): void => {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    postBroadcast('seed-models-invalidate', {
      schemaName: schema.name ?? undefined,
      schemaFileId: schema.schemaFileId ?? undefined,
    })
  } catch (_) {}
}

/**
 * Writes a schema row ({@link upsertSchemaRow} has the matching rules) and returns it.
 * @param schemaFileId - Optional schemaFileId from JSON file for change tracking
 * @param schemaData - Optional full schema content as JSON string (SchemaFileFormat)
 * @param isDraft - Optional flag indicating if schema is in draft state (default: false)
 * @param isEdited - Optional flag indicating if schema has been edited locally (default: false)
 * @param options.db - Write on this transaction; the caller then tells React after it commits.
 *   Without it the write runs in its own transaction.
 * @param options.contentHash - The applied file's hash (applySchemaFile); written with schemaData
 */
export const addSchemaToDb = async (
  schema: Omit<SchemaType, 'id' | 'schemaFileId' | 'schemaData' | 'isDraft' | 'isEdited' | 'contentHash'>,
  schemaFileId?: string,
  schemaData?: string,
  isDraft?: boolean,
  isEdited?: boolean,
  options: { db?: AppDb; contentHash?: string | null } = {},
): Promise<typeof schemas.$inferSelect> => {
  if (!options.db && !BaseDb.getAppDb()) {
    throw new Error('Database not found')
  }
  const input = {
    name: schema.name,
    version: schema.version,
    createdAt: schema.createdAt,
    updatedAt: schema.updatedAt,
    schemaFileId,
    schemaData,
    isDraft,
    isEdited,
    contentHash: options.contentHash,
  }
  if (options.db) {
    const { inserted: _inserted, ...row } = await upsertSchemaRow(options.db, input)
    return row
  }
  const { inserted, ...row } = await inDefinitionsTransaction((tx) => upsertSchemaRow(tx, input))
  if (inserted) broadcastSchemasInvalidate()
  return row
}

/**
 * Renames a model ({@link renameModelRow}), in its own transaction unless `db` is given.
 * @param schemaNameOrId - Schema name or id to scope the rename (required when multiple schemas have models with the same name)
 */
export const renameModelInDb = async (
  oldName: string,
  newName: string,
  schemaNameOrId?: string | number,
  db?: AppDb,
): Promise<NewModelRecord> => {
  if (db) return renameModelRow(db, oldName, newName, schemaNameOrId)
  if (!BaseDb.getAppDb()) throw new Error('Database not found')
  return inDefinitionsTransaction((tx) => renameModelRow(tx, oldName, newName, schemaNameOrId))
}

/**
 * Writes a schema file's models, their property rows and their model_schemas links.
 * @param models - Models to write besides those in schemaFileData.propertyDefinitions
 * @param schema - Optional schema to link models to (a row, or written first when it has no id)
 * @param modelRenames - Optional map of old model names to new model names
 * @param schemaFileData - The file's ids and property definitions: { schemaFileId, modelFileIds: Map<modelName, id>, propertyFileIds: Map<modelName, Map<propertyName, id>>, propertyDefinitions }
 * @param options.db - Write on this transaction; the caller refreshes cached ModelProperty
 *   instances with the returned ids once it has committed. Without it the write runs in its own
 *   transaction and refreshes them itself.
 * @returns The schemaFileIds of the property rows this call changed
 */
export const addModelsToDb = async (
  models: ModelDefinitions,
  schema?: SchemaType,
  modelRenames?: Map<string, string>,
  schemaFileData?: {
    schemaFileId?: string
    modelFileIds?: Map<string, string>
    propertyFileIds?: Map<string, Map<string, string>>
    propertyDefinitions?: Map<string, { [propertyName: string]: any }>
    /**
     * The schema file's property objects as the file states them, by model name; stored in the
     * `definition` column (description and other fields propertyDefinitions leaves out).
     */
    propertyFileDefinitions?: Map<string, { [propertyName: string]: any }>
  },
  options: { db?: AppDb } = {},
): Promise<string[]> => {
  if (!options.db) {
    if (!BaseDb.getAppDb()) throw new Error('Database not found')
    const changed = await inDefinitionsTransaction((tx) =>
      addModelsToDb(models, schema, modelRenames, schemaFileData, { db: tx }),
    )
    // A cached instance is otherwise never re-read from its row (createById returns it as is)
    await refreshCachedProperties(changed)
    return changed
  }
  const db = options.db

  // Model rows and their schema links decide which schema file's nameMatch applies (ADR 0009).
  clearNameMatchLevels()

  // The schema may already be a row (with id)
  let schemaRecord: typeof schemas.$inferSelect | undefined
  if (schema) {
    schemaRecord =
      schema.id !== null && schema.id !== undefined
        ? schema
        : await addSchemaToDb(schema, schemaFileData?.schemaFileId, undefined, undefined, undefined, { db })
  }

  if (modelRenames && schemaRecord) {
    const schemaNameOrId = schemaRecord.name ?? schemaRecord.id
    for (const [oldName, newName] of modelRenames.entries()) {
      await renameModelRow(db, oldName, newName, schemaNameOrId)
    }
  }

  const modelRecords = new Map<string, NewModelRecord>()
  const modelProcessingErrors: Array<{ modelName: string; error: string }> = []
  // Property rows this call changed, so cached ModelProperty instances can be given the new values
  const updatedPropertyFileIds: string[] = []
  const { generateId } = await import('./generateId')

  const modelNames = [...new Set([...Object.keys(models), ...(schemaFileData?.propertyDefinitions?.keys() ?? [])])]
  for (const modelName of modelNames) {
    try {
      const modelFileId = schemaFileData?.modelFileIds?.get(modelName)
      const modelRecord =
        modelRecords.get(modelName) ?? (await findOrCreateModelRow(db, modelName, modelFileId, schemaRecord?.id))
      modelRecords.set(modelName, modelRecord)

      const definitions = schemaFileData?.propertyDefinitions?.get(modelName) ?? {}
      for (const [propertyName, propertyValues] of Object.entries(definitions)) {
        if (!propertyValues) {
          throw new Error(`Property values not found for ${propertyName}`)
        }
        // IDs are assigned before this is called; a generated one doesn't replace a stored id.
        const propertyFileId = schemaFileData?.propertyFileIds?.get(modelName)?.get(propertyName)

        let refModelId: number | null = null
        const refModelName = propertyValues.ref || propertyValues.refModelName
        if (refModelName) {
          let refModel = modelRecords.get(refModelName)
          if (!refModel) {
            const refModelFileId = schemaFileData?.modelFileIds?.get(refModelName)
            refModel = await findOrCreateModelRow(db, refModelName, refModelFileId, schemaRecord?.id)
            modelRecords.set(refModelName, refModel)
          }
          refModelId = refModel.id ?? null
        }

        // ADR 0008: a rename needs the property's id. A name that matches no stored property by id
        // or name is a new property. The schema file is the source of truth for every column, and
        // a property edited locally keeps its row.
        const { row, changed } = await upsertPropertyRow(
          db,
          {
            modelId: modelRecord.id!,
            name: propertyName,
            dataType: propertyValues.dataType,
            schemaFileId: propertyFileId ?? generateId(),
            refModelId,
            refValueType: propertyValues.refValueType ?? null,
            required: propertyValues.required ?? false,
            storage: propertyStorageColumns(propertyValues),
            isEdited: false,
            definition: schemaFileData?.propertyFileDefinitions?.get(modelName)?.[propertyName] ?? propertyValues,
            replaceDefinition: true,
          },
          { keepStoredSchemaFileId: !propertyFileId, keepEditedRow: true },
        )
        if (changed && row?.schemaFileId) updatedPropertyFileIds.push(row.schemaFileId)
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)
      logger(`Error processing model "${modelName}": ${errorMessage}`)
      modelProcessingErrors.push({ modelName, error: errorMessage })
      // Continue processing other models even if one fails
    }
  }

  if (modelProcessingErrors.length > 0) {
    console.warn(`[addModelsToDb] Errors occurred while processing ${modelProcessingErrors.length} model(s):`, modelProcessingErrors.map(e => `${e.modelName}: ${e.error}`).join('; '))
  }

  if (schemaRecord?.id) {
    for (const [modelName, record] of modelRecords) {
      if (!record.id) continue
      if (await linkModelToSchemaRow(db, record.id, schemaRecord.id)) {
        logger(`Linked model ${modelName} (id: ${record.id}) to schema (id: ${schemaRecord.id})`)
      }
    }
  }

  return updatedPropertyFileIds
}

/**
 * The models linked to a schema row (model_schemas) with their property rows, in schema-file
 * shape: `{ [modelName]: { id, properties: { [name]: { dataType, schemaFileId, ref, ... } } } }`.
 * Properties carry their row's definition (validation, description, ...); model-level fields only a
 * schema file holds aren't here, see {@link mergeDbModelsIntoSchemaModels}.
 * @param schemaId - The ID of the schema record in the database
 */
export const loadModelsFromDbForSchema = async (
  schemaId: number,
  db: AppDb | undefined = BaseDb.getAppDb(),
): Promise<{ [modelName: string]: any }> => {
  if (!db) {
    logger('Database not found, cannot load models from DB')
    return {}
  }

  try {
    const linked = await db
      .select({ modelId: modelSchemas.modelId, modelName: modelsTable.name, schemaFileId: modelsTable.schemaFileId })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaId))
    const modelIds = linked.map((row: { modelId: number | null }) => row.modelId).filter((id: number | null): id is number => id != null)
    if (modelIds.length === 0) return {}

    const refModels = alias(modelsTable, 'ref_models')
    const propertyRows = await db
      .select({ property: properties, refName: refModels.name })
      .from(properties)
      .leftJoin(refModels, eq(properties.refModelId, refModels.id))
      .where(inArray(properties.modelId, modelIds))

    const models: { [modelName: string]: any } = {}
    const nameById = new Map<number, string>()
    for (const { modelId, modelName, schemaFileId } of linked) {
      if (!modelId || !modelName) continue
      nameById.set(modelId, modelName)
      // The id (schemaFileId) lets Model.create find the existing row instead of adding a "Post 1".
      models[modelName] = { properties: {}, ...(schemaFileId ? { id: schemaFileId } : {}) }
    }
    for (const { property: prop, refName } of propertyRows as { property: PropertyType; refName: string | null }[]) {
      const modelName = nameById.get(prop.modelId!)
      if (!modelName) continue
      // The row's definition without its row keys; `required` stays the file's
      const { id: _id, _dbId, name: _name, modelId: _modelId, refModelId: _refModelId, refModelName: _refModelName, required: _required, ...definition } =
        propertyDefinitionFromRow(prop, refName)
      models[modelName].properties[prop.name] = {
        ...definition,
        ...(prop.schemaFileId ? { schemaFileId: prop.schemaFileId } : {}),
      }
    }

    logger(`Loaded ${Object.keys(models).length} models from database for schema ${schemaId}`)
    return models
  } catch (error) {
    logger(`Error loading models from database for schema ${schemaId}:`, error)
    return {}
  }
}

/**
 * Merges the models {@link loadModelsFromDbForSchema} read from the database into a schema's
 * models. The database decides which models and properties exist and their stored fields; the
 * schema keeps what only it holds (nameMatch, description, validation, ...), found by id first so
 * a property renamed in the database keeps them. A schema property whose id a database property
 * has is dropped under its old name.
 */
export const mergeDbModelsIntoSchemaModels = (
  schemaModels: { [modelName: string]: any } | undefined,
  dbModels: { [modelName: string]: any },
): { [modelName: string]: any } => {
  const merged: { [modelName: string]: any } = { ...(schemaModels ?? {}) }
  for (const [modelName, dbModel] of Object.entries(dbModels)) {
    const schemaModel = schemaModels?.[modelName]
    if (!schemaModel) {
      merged[modelName] = dbModel
      continue
    }
    const schemaProps: { [name: string]: any } = schemaModel.properties ?? {}
    const dbProps: { [name: string]: any } = dbModel.properties ?? {}
    const schemaNameById = new Map<string, string>()
    for (const [name, prop] of Object.entries(schemaProps)) {
      const id = prop?.id ?? prop?.schemaFileId
      if (id) schemaNameById.set(id, name)
    }
    const properties: { [name: string]: any } = {}
    const matched = new Set<string>()
    for (const [name, dbProp] of Object.entries(dbProps)) {
      const byId = dbProp?.schemaFileId ? schemaNameById.get(dbProp.schemaFileId) : undefined
      const byName = schemaProps[name]
      const byNameId = byName?.id ?? byName?.schemaFileId
      // By name only when the ids don't say it's another property.
      const schemaName =
        byId ?? (byName && !(byNameId && dbProp?.schemaFileId && byNameId !== dbProp.schemaFileId) ? name : undefined)
      const schemaProp = schemaName ? schemaProps[schemaName] : undefined
      if (schemaName && schemaProp) matched.add(schemaName)
      // The database's dataType and ref replace the file's type and model.
      const { type, model, ...fromSchema } = schemaProp ?? {}
      properties[name] = {
        ...fromSchema,
        ...(dbProp?.dataType === undefined && type !== undefined ? { type } : {}),
        ...(dbProp?.ref === undefined && model !== undefined ? { model } : {}),
        ...dbProp,
      }
    }
    const unmatched = Object.fromEntries(Object.entries(schemaProps).filter(([name]) => !matched.has(name)))
    merged[modelName] = { ...schemaModel, ...dbModel, properties: { ...unmatched, ...properties } }
  }
  return merged
}

/**
 * Saves a ModelProperty's edit to its properties row (is_edited true) without updating the schema
 * file, in one transaction. A context without `required` or storage settings leaves the row's.
 * @param property - The ModelPropertyMachineContext with updated values
 */
export const savePropertyToDb = async (
  property: ModelPropertyMachineContext,
): Promise<void> => {
  if (!BaseDb.getAppDb()) {
    throw new Error('Database not found')
  }

  const name = property.name
  if (!name) {
    throw new Error('Property name is required')
  }

  const schemaFileId = property._propertyFileId || (typeof property.id === 'string' ? property.id : undefined)
  const storage = propertyStorageColumns(property)
  await inDefinitionsTransaction(async (tx) => {
    // modelId, then the model of the property row (by its schemaFileId), then modelName in the
    // property's schema. context.modelName can also hold the model's schemaFileId.
    const modelRecord = await resolveModelRecord(
      property.modelName,
      {
        modelId: typeof property.modelId === 'number' ? property.modelId : undefined,
        propertyFileId: schemaFileId,
        modelFileId: property.modelName,
        schemaName: (property as { _schemaName?: string })._schemaName,
      },
      tx,
    )
    if (!modelRecord) {
      throw new Error(
        `Model not found in database (modelId=${property.modelId}, modelName=${property.modelName})`
      )
    }
    await upsertPropertyRow(tx, {
      modelId: modelRecord.id,
      name,
      dataType: property.dataType,
      schemaFileId,
      previousName: property._originalValues?.name,
      refModelName: property.refModelName,
      refModelId: property.refModelName ? undefined : (property.refModelId ?? null),
      refValueType: property.refValueType ?? null,
      required: property.required,
      storage: hasStorageSettings(storage) ? storage : undefined,
      isEdited: true,
      definition: property,
    })
  })
  logger(`Saved property ${property.modelName}:${property.name}`)
}

function parseAddressConfig(value: string | null): NormalizedAddressConfig | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return normalizeAddressConfig(parsed)
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.owned)) {
      return normalizeAddressConfig({
        owned: parsed.owned,
        watched: Array.isArray(parsed.watched) ? parsed.watched : [],
      })
    }
    return null
  } catch {
    return null
  }
}

export const getOwnedAddressesFromDb = async (): Promise<string[]> => {
  const config = await getAddressConfigFromDb()
  return config?.owned ?? []
}

export const getWatchedAddressesFromDb = async (): Promise<string[]> => {
  const config = await getAddressConfigFromDb()
  return config?.watched ?? []
}

/**
 * Returns persisted owned or watched addresses for list filters.
 * Does not include `getAdditionalSyncAddresses` (those are extra EAS indexers).
 */
export const getAddressesForItemsFilter = async (
  addressFilter: 'owned' | 'watched',
): Promise<string[]> => {
  if (addressFilter === 'owned') {
    return getOwnedAddressesFromDb()
  }
  return getWatchedAddressesFromDb()
}

/**
 * Returns owned + watched addresses. Use for EAS sync and file download.
 */
export const getAllAddressesFromDb = async (): Promise<string[]> => {
  const config = await getAddressConfigFromDb()
  if (!config) return []
  return [...config.owned, ...config.watched]
}

async function getAddressConfigFromDb(): Promise<NormalizedAddressConfig | null> {
  // Before init opens the database (or with no init) there are no stored addresses to read
  const appDb = await whenDbReady()
  if (!appDb) return null

  const appStatesRecords = await appDb
    .select()
    .from(appState)
    .where(eq(appState.key, 'addresses'))
    .limit(1)

  if (!appStatesRecords || appStatesRecords.length === 0) {
    return null
  }

  const addressArrayString = appStatesRecords[0].value
  return parseAddressConfig(addressArrayString)
}

/**
 * Writes a runtime-created model: its models row (is_edited true when new), its model_schemas link
 * and the properties given, in one transaction. Returns the model's row id.
 * @param modelFileId - The model file ID (schema_file_id)
 * @param data - Model data including modelName, schemaId, and optional properties
 */
export async function writeModelToDb(
  modelFileId: string,
  data: {
    modelName: string
    schemaId: number
    properties?: { [name: string]: any }
  }
): Promise<number> {
  if (!BaseDb.getAppDb()) throw new Error('Database not available')
  if (!data.schemaId || !Number.isInteger(data.schemaId) || data.schemaId <= 0) {
    throw new Error(`Invalid schemaId: ${data.schemaId}. Schema record must exist before creating join entry.`)
  }
  const { generateId } = await import('./generateId')

  const { linked, schema, modelId } = await inDefinitionsTransaction(async (tx) => {
    const [schema] = await tx
      .select({ id: schemas.id, name: schemas.name, schemaFileId: schemas.schemaFileId })
      .from(schemas)
      .where(eq(schemas.id, data.schemaId))
      .limit(1)
    if (!schema) {
      throw new Error(`Schema with id ${data.schemaId} does not exist in database. Cannot create join record.`)
    }
    const model = await upsertModelRow(tx, { name: data.modelName, schemaFileId: modelFileId, isEdited: true })
    const linked = await linkModelToSchemaRow(tx, model.id!, data.schemaId)
    for (const [propName, propData] of Object.entries(data.properties ?? {})) {
      const refModelName = propData.refModelName || propData.ref
      const storage = propertyStorageColumns(propData)
      // A stored row keeps its id; the given or a generated one is for a new row.
      await upsertPropertyRow(
        tx,
        {
          modelId: model.id!,
          name: propName,
          dataType: propData.dataType,
          schemaFileId: propData.id ?? generateId(),
          refModelName,
          refModelId: refModelName ? undefined : (propData.refModelId ?? null),
          refValueType: propData.refValueType ?? null,
          required: propData.required,
          storage: hasStorageSettings(storage) ? storage : undefined,
          definition: propData,
        },
        { keepStoredSchemaFileId: true },
      )
    }
    return { linked, schema, modelId: model.id! }
  })
  if (linked) broadcastModelsInvalidate(schema)
  logger(`Wrote model ${data.modelName} (${modelFileId}) to database`)
  return modelId
}

/**
 * Writes a property's row by its file id ({@link upsertPropertyRow}), in its own transaction.
 * `required` and storage settings the data leaves out keep the row's.
 * @param propertyFileId - The property file ID (schema_file_id)
 * @param data - Property data including modelId, name, dataType, and other property fields
 * @param isEdited - Optional flag indicating if property has been edited locally. Left unset, an update
 *   keeps the row's flag (a load or creation write must not clear an unsaved edit) and an insert stores false.
 */
export async function writePropertyToDb(
  propertyFileId: string,
  data: {
    modelId: number
    name: string
    dataType: string
    refModelName?: string
    refModelId?: number
    refValueType?: string
    required?: boolean
    storageType?: string
    localStorageDir?: string
    filenameSuffix?: string
    [key: string]: any
  },
  isEdited?: boolean
): Promise<void> {
  if (!BaseDb.getAppDb()) throw new Error('Database not available')
  const refModelName = data.refModelName || data.ref
  const storage = propertyStorageColumns(data)
  await inDefinitionsTransaction((tx) =>
    upsertPropertyRow(tx, {
      modelId: data.modelId,
      name: data.name,
      dataType: data.dataType,
      schemaFileId: propertyFileId,
      refModelName,
      refModelId: refModelName ? undefined : (data.refModelId ?? null),
      refValueType: data.refValueType ?? null,
      required: data.required,
      storage: hasStorageSettings(storage) ? storage : undefined,
      isEdited,
      definition: data,
    }),
  )
  logger(`Wrote property ${data.name} (${propertyFileId})`)
}
