import {
  appState,
  metadata,
  models as modelsTable,
  NewModelRecord,
  NewPropertyRecord,
  pendingWrites,
  properties,
  PropertyType,
  seeds,
} from '@/seedSchema'
import { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { ModelDefinitions } from '@/types'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { easName } from '@seedprotocol/eas'
import { listRelationEasPropertyName, toMetadataPropertyName } from '@/helpers/metadataPropertyNames'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { BaseDb } from '@/db/Db/BaseDb'
import { SchemaType, schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { InferInsertModel } from 'drizzle-orm'
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine'
import { refreshCachedProperties } from './cachedPropertyRefresh'
// Dynamic import to break circular dependency: Model -> ... -> helpers/db -> ModelProperty -> ... -> Model
// import { ModelProperty } from '@/ModelProperty/ModelProperty'
import debug from 'debug'
import { isSqliteUniqueConstraintError } from '@/helpers/isSqliteUniqueConstraintError'
import { clearNameMatchLevels } from '@/db/read/nameMatchLevels'
import {
  resolveModelRecord,
  resolveModelRecordByNameOrType,
  resolveRefModelRecord,
  type ModelScope,
} from '@/db/read/resolveModelRecord'
import { normalizeAddressConfig, type NormalizedAddressConfig } from '@/helpers/addresses'
import { normalizeDataType, normalizePropertyRecordSchema } from '@/helpers/property'
import { propertyDefinitionColumn } from '@/helpers/propertyDefinition'
import { insertModelSchemaLink, linkModelToSchema } from '@/db/write/linkModelToSchema'
import { AmbiguousModelError } from '@/Model/errors'

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

/**
 * True when the models row is linked (model_schemas) to any schema other than schemaId.
 */
const isModelLinkedToOtherSchema = async (
  db: BetterSQLite3Database | SqliteRemoteDatabase,
  modelId: number,
  schemaId?: number,
): Promise<boolean> => {
  const links = await (db as BetterSQLite3Database)
    .select({ schemaId: modelSchemas.schemaId })
    .from(modelSchemas)
    .where(eq(modelSchemas.modelId, modelId))
  return links.some((l: { schemaId: number | null }) => l.schemaId !== schemaId)
}

const isModelLinkedToAnySchema = async (
  db: BetterSQLite3Database | SqliteRemoteDatabase,
  modelId: number,
): Promise<boolean> => {
  const links = await (db as BetterSQLite3Database)
    .select({ id: modelSchemas.id })
    .from(modelSchemas)
    .where(eq(modelSchemas.modelId, modelId))
    .limit(1)
  return links.length > 0
}

/**
 * Find or create a models row by schemaFileId (preferred) or name.
 * Reuses an existing same-name row (especially schemaFileId=null stubs created via
 * ref resolution) instead of inserting a second row — models.name is not unique,
 * and duplicate names break name lookups (e.g. Resource.tags → Tag).
 *
 * When modelFileId is given, a same-name row that already carries a *different*
 * non-null schemaFileId is only adopted if no other schema is linked to it via
 * model_schemas. Otherwise it belongs to another schema (e.g. two schemas that each
 * define "Post"), and re-id'ing it would strand that schema's cached Model instance,
 * so a new row is inserted instead.
 */
const findOrCreateModelRecord = async (
  db: BetterSQLite3Database | SqliteRemoteDatabase,
  modelName: string,
  modelFileId?: string,
  schemaId?: number,
): Promise<NewModelRecord> => {
  if (modelFileId) {
    const byFileId = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, modelFileId))
      .limit(1)
    if (byFileId.length > 0) {
      const record = byFileId[0] as NewModelRecord
      if (record.name !== modelName) {
        await db
          .update(modelsTable)
          .set({ name: modelName })
          .where(eq(modelsTable.id, record.id!))
        return { ...record, name: modelName }
      }
      return record
    }
  }

  const byName = (await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.name, modelName))) as NewModelRecord[]

  if (byName.length > 0) {
    // Prefer exact file-id match, then (for refs without a file id) this schema's row, then an
    // adoptable null schemaFileId stub, then any single row.
    let chosen: NewModelRecord | undefined = modelFileId
      ? byName.find((r) => r.schemaFileId === modelFileId)
      : undefined
    if (!chosen && !modelFileId && schemaId && byName.length > 1) {
      for (const candidate of byName) {
        if (!(await isModelLinkedToOtherSchema(db, candidate.id!, schemaId))) {
          const links = await (db as BetterSQLite3Database)
            .select({ schemaId: modelSchemas.schemaId })
            .from(modelSchemas)
            .where(eq(modelSchemas.modelId, candidate.id!))
          if (links.length > 0) {
            chosen = candidate
            break
          }
        }
      }
    }
    chosen ??= byName.find((r) => !r.schemaFileId)

    if (!chosen && modelFileId) {
      // Every same-name row has a different file id. Only adopt one that no other
      // schema claims; otherwise fall through and insert a row for this file id.
      // A row with a file id that no schema links is a deleted schema's leftover (its old
      // properties are still attached), not an unclaimed row: don't adopt it either.
      for (const candidate of byName) {
        if (candidate.schemaFileId && !(await isModelLinkedToAnySchema(db, candidate.id!))) continue
        if (!(await isModelLinkedToOtherSchema(db, candidate.id!, schemaId))) {
          chosen = candidate
          break
        }
      }
    } else if (!chosen) {
      chosen =
        (byName.length === 1 ? byName[0] : undefined) ||
        byName.find((r) => !!r.schemaFileId) ||
        byName[0]
    }

    if (chosen && modelFileId && chosen.schemaFileId !== modelFileId) {
      const conflict = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)
      if (conflict.length > 0) {
        return conflict[0] as NewModelRecord
      }
      // Adopt stub (null schemaFileId) or an unclaimed same-name row by attaching this file id.
      await db
        .update(modelsTable)
        .set({ schemaFileId: modelFileId, isEdited: false })
        .where(eq(modelsTable.id, chosen.id!))
      chosen = { ...chosen, schemaFileId: modelFileId, isEdited: false }
      logger(
        `Adopted existing model "${modelName}" (id: ${chosen.id}) with schemaFileId "${modelFileId}"`,
      )
    }

    if (chosen) {
      return chosen
    }
  }

  try {
    // A Model instance's own write can insert this file id between the lookups above and here
    // (schema import writes each model twice at once). DO NOTHING instead of a failed statement,
    // which sqlite-wasm logs as a warning even though the error is caught.
    const inserted = await db
      .insert(modelsTable)
      .values({
        name: modelName,
        schemaFileId: modelFileId || null,
        isEdited: false,
      })
      .onConflictDoNothing()
      .returning()
    if (inserted.length > 0) {
      return inserted[0] as NewModelRecord
    }
    if (modelFileId) {
      const existing = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)
      if (existing.length > 0) {
        return existing[0] as NewModelRecord
      }
    }
    throw new Error(`Model "${modelName}" was not inserted and no row has schemaFileId "${modelFileId}"`)
  } catch (error: any) {
    if (isSqliteUniqueConstraintError(error) && modelFileId) {
      const existing = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)
      if (existing.length > 0) {
        return existing[0] as NewModelRecord
      }
    }
    // Race: another writer inserted by name — reuse rather than throw on duplicates.
    const raced = (await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.name, modelName))) as NewModelRecord[]
    if (raced.length > 0) {
      return (
        (modelFileId
          ? raced.find((r) => r.schemaFileId === modelFileId)
          : undefined) ||
        raced.find((r) => !r.schemaFileId) ||
        raced[0]
      )
    }
    throw error
  }
}

/**
 * Find or create the models row a Relation property on ownerModelId points to. Model names are only
 * unique per schema, so the ref is looked up in the owner's schema(s) first; a global name lookup
 * by name threw "Multiple records found" once two schemas defined the ref model.
 */
const findOrCreateRefModelRecord = async (
  db: BetterSQLite3Database | SqliteRemoteDatabase,
  refModelName: string,
  ownerModelId: number,
): Promise<{ id?: number | null }> => {
  try {
    const ref = await resolveRefModelRecord(refModelName, { modelId: ownerModelId }, db)
    if (ref) return ref
  } catch (error) {
    // Not in the owner's schema and defined by several others: pick/create like an import does
    if (!(error instanceof AmbiguousModelError)) throw error
  }
  const [ownerLink] = await (db as BetterSQLite3Database)
    .select({ schemaId: modelSchemas.schemaId })
    .from(modelSchemas)
    .where(eq(modelSchemas.modelId, ownerModelId))
    .limit(1)
  return findOrCreateModelRecord(db, refModelName, undefined, ownerLink?.schemaId ?? undefined)
}

type AppDb = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/**
 * Finds the schema row by schemaFileId, else by name, updates the fields given, or inserts one.
 *
 * By name: a draft write takes a draft of that name; a published write takes a published row,
 * else a draft (which it publishes). A published row keeps its schemaFileId against another id of
 * the same version, and keeps its newer version against an older version's file.
 * @param schemaFileId - Optional schemaFileId from JSON file for change tracking
 * @param schemaData - Optional full schema content as JSON string (SchemaFileFormat)
 * @param isDraft - Optional flag indicating if schema is in draft state (default: false)
 * @param isEdited - Optional flag indicating if schema has been edited locally (default: false)
 * @param options.db - Run on this database (a transaction) instead of the app database
 * @param options.contentHash - The applied file's hash (applySchemaFile); written with schemaData
 * @returns The schema record (either existing or newly created)
 */
export const addSchemaToDb = async (
  schema: Omit<SchemaType, 'id' | 'schemaFileId' | 'schemaData' | 'isDraft' | 'isEdited' | 'contentHash'>,
  schemaFileId?: string,
  schemaData?: string,
  isDraft?: boolean,
  isEdited?: boolean,
  options: { db?: AppDb; contentHash?: string | null } = {},
): Promise<typeof schemas.$inferSelect> => {
  const db = options.db ?? BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

  // The stored schema file may change its nameMatch levels (ADR 0009).
  clearNameMatchLevels()

  type SchemaRow = typeof schemas.$inferSelect
  const update = async (existing: SchemaRow, updates: Partial<typeof schemas.$inferInsert>): Promise<SchemaRow> => {
    if (schema.name && existing.name !== schema.name) updates.name = schema.name
    if (schemaData !== undefined) updates.schemaData = schemaData
    if (options.contentHash !== undefined && existing.contentHash !== options.contentHash) {
      updates.contentHash = options.contentHash
    }
    if (schema.version !== undefined && existing.version !== schema.version) updates.version = schema.version
    if (isDraft !== undefined && existing.isDraft !== isDraft) updates.isDraft = isDraft
    if (isEdited !== undefined && existing.isEdited !== isEdited) updates.isEdited = isEdited
    if (schema.updatedAt && existing.updatedAt !== schema.updatedAt) updates.updatedAt = schema.updatedAt
    if (Object.keys(updates).length === 0) return existing
    await db.update(schemas).set(updates).where(eq(schemas.id, existing.id!))
    return { ...existing, ...updates }
  }

  if (schemaFileId) {
    const [byFileId] = await db.select().from(schemas).where(eq(schemas.schemaFileId, schemaFileId)).limit(1)
    if (byFileId) return update(byFileId, {})
  }

  if (isDraft === true) {
    const [byName] = await db.select().from(schemas).where(eq(schemas.name, schema.name)).limit(1)
    if (byName?.isDraft === true) {
      const updates: Partial<typeof schemas.$inferInsert> = {
        updatedAt: schema.updatedAt || Date.now(),
      }
      if (schemaFileId && byName.schemaFileId !== schemaFileId) updates.schemaFileId = schemaFileId
      return update(byName, updates)
    }
  }

  // By name: a published write prefers a published row, then takes a draft of that name.
  let [existing] = await db
    .select()
    .from(schemas)
    .where(
      isDraft === false
        ? and(eq(schemas.name, schema.name), eq(schemas.isDraft, false))
        : eq(schemas.name, schema.name),
    )
    .limit(1)
  if (!existing && isDraft === false) {
    ;[existing] = await db
      .select()
      .from(schemas)
      .where(and(eq(schemas.name, schema.name), eq(schemas.isDraft, true)))
      .limit(1)
  }

  if (existing) {
    // A complete schema file can bring a version under its own id (imported files may not keep it).
    const isOtherVersionFile =
      !!schemaFileId &&
      !!existing.schemaFileId &&
      existing.schemaFileId !== schemaFileId &&
      existing.isDraft !== true &&
      schema.version !== undefined &&
      schema.version !== existing.version
    if (isOtherVersionFile && schema.version! < existing.version) {
      // An older version's file: rolling the row back to it would leave the newer version's id
      // pointing at the older version's data.
      logger(`Keeping schema "${schema.name}" at v${existing.version}; not replacing it with older v${schema.version}`)
      return existing
    }
    const updates: Partial<typeof schemas.$inferInsert> = {}
    // A published row keeps its id unless this is a newer version's file; a draft or id-less row
    // takes the new one.
    if (
      schemaFileId &&
      existing.schemaFileId !== schemaFileId &&
      (existing.isDraft === true || !existing.schemaFileId || isOtherVersionFile)
    ) {
      updates.schemaFileId = schemaFileId
    }
    return update(existing, updates)
  }

  type NewSchemaRecord = InferInsertModel<typeof schemas>
  const newSchema = await db.insert(schemas).values({
    name: schema.name,
    version: schema.version,
    schemaFileId: schemaFileId || null,
    schemaData: schemaData || null,
    contentHash: options.contentHash ?? null,
    isDraft: isDraft ?? false,
    isEdited: isEdited ?? false,
    createdAt: schema.createdAt,
    updatedAt: schema.updatedAt,
  } as NewSchemaRecord).returning()

  // Notify React useSchemas so it can invalidate; live query often doesn't re-run when schemas table is inserted.
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      await new Promise((r) => setTimeout(r, 10))
      postBroadcast('seed-schemas-invalidate', {})
    } catch (_) {}
  }

  return newSchema[0]
}

/**
 * Rename a model in the database
 * Updates the model name and all properties that reference it
 * @param oldName - The current model name
 * @param newName - The new model name
 * @param schemaNameOrId - Schema name or schema ID to scope the rename (required when multiple schemas have models with the same name)
 * @returns The updated model record
 */
export const renameModelInDb = async (
  oldName: string,
  newName: string,
  schemaNameOrId?: string | number,
  db: AppDb | undefined = BaseDb.getAppDb(),
): Promise<NewModelRecord> => {

  if (!db) {
    throw new Error('Database not found')
  }

  // Scoped: only that schema's model (no name-only fallback). Unscoped: the name alone, which
  // throws AmbiguousModelError when several schemas define it.
  const scope =
    schemaNameOrId === undefined
      ? {}
      : typeof schemaNameOrId === 'number'
        ? { schemaId: schemaNameOrId, strict: true }
        : { schemaName: schemaNameOrId, strict: true }

  const modelToRename = await resolveModelRecord(oldName, scope, db)
  if (!modelToRename) {
    if (schemaNameOrId !== undefined) {
      throw new Error(
        `Model "${oldName}" not found in schema "${schemaNameOrId}"`,
      )
    }
    // Backward compat: model doesn't exist, create it with new name
    const newModel = await db.insert(modelsTable).values({ name: newName }).returning()
    return newModel[0] as NewModelRecord
  }

  // A model with the new name already exists in the same schema: return it
  const existingWithNewName = await resolveModelRecord(newName, scope, db)
  if (existingWithNewName) {
    return existingWithNewName as NewModelRecord
  }

  // Update the model name
  await db
    .update(modelsTable)
    .set({ name: newName })
    .where(eq(modelsTable.id, modelToRename.id!))

  return { ...modelToRename, name: newName } as NewModelRecord
}

/**
 * Adds models and their properties to the database.
 * Optionally connects models to a schema via join records.
 * @param models - The model definitions to add (with schemaFileData.propertyDefinitions, its models are added too)
 * @param schema - Optional schema to connect models to
 * @param modelRenames - Optional map of old model names to new model names for handling renames
 * @param schemaFileData - Optional object containing schemaFileId mappings from JSON file: { schemaFileId, modelFileIds: Map<modelName, id>, propertyFileIds: Map<modelName, Map<propertyName, id>> }
 * @param options.db - Run on this database (a transaction). The caller then refreshes cached
 *   ModelProperty instances with the returned ids once it has committed.
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
  const db = options.db ?? BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

  // Model rows and their schema links decide which schema file's nameMatch applies (ADR 0009).
  clearNameMatchLevels()

  // If schema is provided, add it to the database
  // Note: schema might already be a database record (with id) if passed from importJsonSchema
  let schemaRecord: typeof schemas.$inferSelect | undefined
  if (schema) {
    // Check if schema already has an id (it's already a database record)
    // SchemaType includes id, so check if it's set
    if (schema.id !== null && schema.id !== undefined) {
      schemaRecord = schema
      logger(`Using existing schema record with id: ${schemaRecord.id}`)
    } else {
      schemaRecord = await addSchemaToDb(schema, schemaFileData?.schemaFileId, undefined, undefined, undefined, { db })
      logger(`Created/found schema record with id: ${schemaRecord.id}`)
    }
  }

  // Handle model renames first if provided
  if (modelRenames && schemaRecord) {
    const schemaNameOrId = schemaRecord.name ?? schemaRecord.id
    for (const [oldName, newName] of modelRenames.entries()) {
      await renameModelInDb(oldName, newName, schemaNameOrId, db)
    }
  }

  // Search for all models by schemaFileId (preferred) or name and create them if they don't exist
  const modelRecords = new Map<string, NewModelRecord>()
  const modelProcessingErrors: Array<{ modelName: string; error: string }> = []
  
  // Property rows this call changed, so cached ModelProperty instances can be given the new values
  const updatedPropertyFileIds: string[] = []

  const modelNames = [...new Set([...Object.keys(models), ...(schemaFileData?.propertyDefinitions?.keys() ?? [])])]
  for (const modelName of modelNames) {
    const modelClass = models[modelName]
    try {
      const modelFileId = schemaFileData?.modelFileIds?.get(modelName)

      let modelRecord = await findOrCreateModelRecord(db, modelName, modelFileId, schemaRecord?.id)

      // Keep schemaFileId aligned when findOrCreate returned a row that still needs adoption
      // (rare: findOrCreate handles stubs and unclaimed same-name rows itself).
      if (modelFileId && modelRecord.schemaFileId !== modelFileId) {
        const existingWithFileId = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.schemaFileId, modelFileId))
          .limit(1)

        if (existingWithFileId.length > 0 && existingWithFileId[0].id !== modelRecord.id) {
          logger(`WARNING: Model "${modelName}" (id: ${modelRecord.id}) conflicts with existing model "${existingWithFileId[0].name}" (id: ${existingWithFileId[0].id}) both trying to use schemaFileId "${modelFileId}"`)
          modelRecord = existingWithFileId[0] as NewModelRecord
        } else if (!modelRecord.schemaFileId) {
          await db
            .update(modelsTable)
            .set({ schemaFileId: modelFileId })
            .where(eq(modelsTable.id, modelRecord.id!))
          modelRecord = { ...modelRecord, schemaFileId: modelFileId }
        }
      }

      modelRecords.set(modelName, modelRecord)

      // Get all existing properties for this model upfront to handle renamed properties
      const allDbProperties = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, modelRecord.id!))

    // Track which DB properties have been matched to schema properties
    const matchedDbPropertyIds = new Set<number>()
    
    // Get properties from Model context (where they're stored as an object when Model is created)
    // modelClass.properties returns ModelProperty instances from DB, but we need the context properties
    // which are stored as an object when Model.create() is called with properties
    const modelContext = (modelClass as any)?._getSnapshotContext?.() || {}
    const contextProperties = modelContext.properties || {}
    // When models are created from JSON, properties are stored as _pendingPropertyDefinitions
    const pendingProperties = modelContext._pendingPropertyDefinitions || {}
    
    // If context properties are empty, try modelClass.properties (for backward compatibility)
    // but convert ModelProperty instances to object format
    // Property definitions read from the schema file win: a cached Model keeps the properties it
    // was created with, so after a rename its context still has the old name.
    const filePropertyDefinitions = schemaFileData?.propertyDefinitions?.get(modelName)
    let schema: { [propertyName: string]: any } = {}
    if (filePropertyDefinitions) {
      schema = filePropertyDefinitions
    } else if (Object.keys(contextProperties).length > 0) {
      schema = contextProperties
    } else if (Object.keys(pendingProperties).length > 0) {
      // Use pending property definitions (from JSON import)
      schema = pendingProperties
    } else {
      const modelHelpersMod = await import('./model')
      const { modelPropertiesToObject } = modelHelpersMod
      const modelProperties = modelClass?.properties || []
      schema = modelPropertiesToObject(modelProperties)
    }

    // Search for all properties and create them if they don't exist
    // Properties are unique by name + modelId, so we search using both
    const schemaEntries = Object.entries(schema)
    for (let index = 0; index < schemaEntries.length; index++) {
      const [propertyName, propertyValues] = schemaEntries[index]
      if (!propertyValues) {
        throw new Error(`Property values not found for ${propertyName}`)
      }
      
      // Get property schemaFileId if available
      let propertyFileId = schemaFileData?.propertyFileIds?.get(modelName)?.get(propertyName)
      const propertyFileIdGenerated = !propertyFileId

      // If no propertyFileId from map, generate a random ID
      // IDs should be generated in the import process before calling addModelsToDb
      if (!propertyFileId) {
        const { generateId } = await import('./generateId')
        propertyFileId = generateId()
        logger(`Generated propertyFileId "${propertyFileId}" for property "${modelName}:${propertyName}" (not found in propertyFileIds map)`)
      }
      
      // First, try to find by schemaFileId (preferred for change tracking)
      let existingProperty: PropertyType | undefined
      if (propertyFileId) {
        existingProperty = allDbProperties.find(
          (p: PropertyType) => p.schemaFileId === propertyFileId && !matchedDbPropertyIds.has(p.id!)
        )
      }
      
      // Fallback: check if property exists by name + modelId
      if (!existingProperty) {
        existingProperty = allDbProperties.find(
          (p: PropertyType) => p.name === propertyName && !matchedDbPropertyIds.has(p.id!)
        )
      }

      // Prepare property values
      const propertyData: Partial<NewPropertyRecord> = {
        name: propertyName,
        modelId: modelRecord.id!,
        dataType: normalizeDataType(propertyValues.dataType),
        schemaFileId: propertyFileId || null,
        required: propertyValues.required ?? false,
        // The schema file is the source of truth here: no storage config means none.
        ...propertyStorageColumns(propertyValues),
        definition: propertyDefinitionColumn(
          schemaFileData?.propertyFileDefinitions?.get(modelName)?.[propertyName] ?? propertyValues,
        ),
      }

      // Handle ref property - create ref model if needed
      // Check both ref and refModelName (refModelName is set by createModelFromJson)
      const refModelName = propertyValues.ref || propertyValues.refModelName
      if (refModelName) {
        // When ref model was already processed in this batch, use it (avoids db round-trip)
        const cachedRef = modelRecords.get(refModelName)
        const refModelFileId = schemaFileData?.modelFileIds?.get(refModelName)
        const refModel = cachedRef
          ? cachedRef
          : await findOrCreateModelRecord(db, refModelName, refModelFileId, schemaRecord?.id)
        if (!cachedRef) {
          modelRecords.set(refModelName, refModel)
        }
        propertyData.refModelId = refModel.id ?? null
      } else {
        // If it's not a Relation type, ensure refModelId is null
        propertyData.refModelId = null
      }

      if (propertyValues.refValueType) {
        propertyData.refValueType = normalizeDataType(propertyValues.refValueType)
      } else {
        // If refValueType is not set, ensure it's null
        propertyData.refValueType = null
      }

      // ADR 0008: a rename needs the property's id. A name that matches no stored property by id
      // or name is a new property, even if one of the same type was removed in the same edit.

      if (existingProperty) {
        // Mark this DB property as matched
        matchedDbPropertyIds.add(existingProperty.id!)
        
        // A property edited locally keeps its row.
        const isPropertyEdited = existingProperty.isEdited === true
        
        if (isPropertyEdited) {
          // Property has been locally edited - skip update to preserve local changes
          logger(
            `Skipping update for property ${modelName}:${existingProperty.name} -> ${propertyName} - it has been locally edited and will be preserved`,
          )
          continue
        }
        
        // Property exists (possibly with different name) - update it with new values from schema file
        // This handles both regular updates and renames
        // Ensure schemaFileId is updated if we have it
        // Preserve existing isEdited value if it was true (local edits take precedence)
        const updateData = { ...propertyData }
        // A generated id must not replace the one the row already has from its schema file
        if (propertyFileIdGenerated && existingProperty.schemaFileId) {
          updateData.schemaFileId = existingProperty.schemaFileId
        }
        if (existingProperty.isEdited === true) {
          // Preserve isEdited = true if property was locally edited
          delete updateData.isEdited
        } else {
          updateData.isEdited = false
        }
        // Skip db.update when data unchanged (avoids slow OPFS writes in browser)
        const unchanged =
          existingProperty.name === updateData.name &&
          existingProperty.dataType === updateData.dataType &&
          existingProperty.schemaFileId === (updateData.schemaFileId ?? null) &&
          existingProperty.required === (updateData.required ?? false) &&
          existingProperty.refModelId === (updateData.refModelId ?? null) &&
          existingProperty.refValueType === (updateData.refValueType ?? null) &&
          (existingProperty.storageType ?? null) === (updateData.storageType ?? null) &&
          (existingProperty.localStorageDir ?? null) === (updateData.localStorageDir ?? null) &&
          (existingProperty.filenameSuffix ?? null) === (updateData.filenameSuffix ?? null) &&
          (existingProperty.definition ?? null) === (updateData.definition ?? null) &&
          existingProperty.isEdited === (updateData.isEdited ?? false)
        if (!unchanged) {
          await db
            .update(properties)
            .set(updateData)
            .where(eq(properties.id, existingProperty.id!))
          const updatedFileId = updateData.schemaFileId ?? existingProperty.schemaFileId
          if (updatedFileId) updatedPropertyFileIds.push(updatedFileId)
        }
      } else {
        // Property doesn't exist, create it with schemaFileId
        // Set isEdited = false when loading from schema file
        const propertyDataWithIsEdited = {
          ...propertyData,
          isEdited: false,
        }
        // Global schemaFileId lookup (unique across all models) before insert — avoids
        // UNIQUE races when the property already exists on another model row or from a prior pass.
        if (propertyFileId) {
          const existingByFileId = await db
            .select()
            .from(properties)
            .where(eq(properties.schemaFileId, propertyFileId))
            .limit(1)
          if (existingByFileId.length > 0) {
            const found = existingByFileId[0] as PropertyType
            matchedDbPropertyIds.add(found.id!)
            logger(
              `Property ${modelName}:${propertyName} already exists by schemaFileId "${propertyFileId}" (id: ${found.id}), skipping insert`,
            )
            continue
          }
        }

        logger(`Creating new property ${modelName}:${propertyName} with schemaFileId: ${propertyData.schemaFileId}`)
        // A conflict means the row already exists: the schema import's Model instances write their
        // properties at the same time as this. DO NOTHING keeps sqlite-wasm from logging a failed insert.
        const inserted = await db
          .insert(properties)
          .values(propertyDataWithIsEdited)
          .onConflictDoNothing()
          .returning({ id: properties.id })
        if (inserted.length === 0) {
          logger(`Property ${modelName}:${propertyName} already exists (UNIQUE constraint), treating as success`)
        }
      }
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
    logger(`Errors processing models: ${modelProcessingErrors.map(e => e.modelName).join(', ')}`)
  }

  // If schema was provided, create modelSchema join records to connect models to the schema
  if (schemaRecord && schemaRecord.id) {
    const modelIds = [...modelRecords.entries()]
      .filter(([, r]) => r.id)
      .map(([name, r]) => ({ modelName: name, modelId: r.id! }))
    if (modelIds.length === 0) {
      logger('No model IDs to link, skipping schema linking')
    } else {
      // Single batch query: get all existing joins for this schema
      const existingJoins = await db
        .select({ modelId: modelSchemas.modelId })
        .from(modelSchemas)
        .where(eq(modelSchemas.schemaId, schemaRecord.id))
      const existingSet = new Set(existingJoins.map((r: { modelId: number }) => r.modelId))

      const toInsert = modelIds.filter(({ modelId }) => !existingSet.has(modelId))
      if (toInsert.length > 0) {
        for (const { modelName, modelId } of toInsert) {
          const link = options.db ? insertModelSchemaLink : linkModelToSchema
          if (!(await link(db, modelId, schemaRecord.id))) continue
          logger(`Created join table entry for model ${modelName} (id: ${modelId}) to schema (id: ${schemaRecord.id})`)
        }
      }
    }
  } else if (schemaRecord && !schemaRecord.id) {
    logger(`Warning: schemaRecord provided but has no id, cannot create join table entries`)
  }

  // A cached instance is otherwise never re-read from its row (createById returns it as is)
  if (!options.db) await refreshCachedProperties(updatedPropertyFileIds)
  return updatedPropertyFileIds
}

/**
 * The models linked to a schema row (model_schemas) with their property rows, in schema-file
 * shape: `{ [modelName]: { id, properties: { [name]: { dataType, schemaFileId, ref, ... } } } }`.
 * Fields only a schema file holds (validation, description, ...) aren't here; see
 * {@link mergeDbModelsIntoSchemaModels}.
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
      models[modelName].properties[prop.name] = {
        dataType: normalizeDataType(prop.dataType ?? undefined),
        ...(prop.schemaFileId ? { schemaFileId: prop.schemaFileId } : {}),
        ...(refName ? { ref: refName } : {}),
        ...(prop.refValueType ? { refValueType: normalizeDataType(prop.refValueType) } : {}),
        ...(prop.storageType ? { storageType: prop.storageType } : {}),
        ...(prop.localStorageDir ? { localStorageDir: prop.localStorageDir } : {}),
        ...(prop.filenameSuffix ? { filenameSuffix: prop.filenameSuffix } : {}),
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
 * Saves a property's changes to the database without updating the JSON schema file.
 * This is used when properties are edited but the schema hasn't been saved as a new version yet.
 * @param property - The ModelPropertyMachineContext with updated values
 */
export const savePropertyToDb = async (
  property: ModelPropertyMachineContext,
): Promise<void> => {
  const db = BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

  if (!property.name) {
    throw new Error('Property name is required')
  }

  // modelId, then the model of the property row (by its schemaFileId), then modelName in the
  // property's schema. context.modelName can also hold the model's schemaFileId.
  const schemaFileId = property._propertyFileId || (typeof property.id === 'string' ? property.id : undefined)
  const modelRecord = await resolveModelRecord(
    property.modelName,
    {
      modelId: typeof property.modelId === 'number' ? property.modelId : undefined,
      propertyFileId: schemaFileId,
      modelFileId: property.modelName,
      schemaName: (property as { _schemaName?: string })._schemaName,
    },
    db,
  )
  if (!modelRecord) {
    throw new Error(
      `Model not found in database (modelId=${property.modelId}, modelName=${property.modelName})`
    )
  }

  // Find existing property - try multiple strategies to handle name changes
  // 1. First try by schemaFileId (most reliable - doesn't change when name changes)
  let existingProperties: any[] = []
  
  logger(`[savePropertyToDb] Looking for property ${property.modelName}:${property.name} (schemaFileId: ${schemaFileId}, originalName: ${property._originalValues?.name})`)
  
  if (schemaFileId) {
    existingProperties = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.schemaFileId, schemaFileId),
          eq(properties.modelId, modelRecord.id!),
        ),
      )
      .limit(1)
    logger(`[savePropertyToDb] Found ${existingProperties.length} properties by schemaFileId`)
  }
  
  // 2. If not found by schemaFileId, try by original name (if name was changed)
  if (existingProperties.length === 0 && property._originalValues?.name && property._originalValues.name !== property.name) {
    logger(`[savePropertyToDb] Trying to find by original name: ${property._originalValues.name}`)
    existingProperties = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.name, property._originalValues.name),
          eq(properties.modelId, modelRecord.id!),
        ),
      )
      .limit(1)
    logger(`[savePropertyToDb] Found ${existingProperties.length} properties by original name`)
  }
  
  // 3. Fallback: try by current name
  if (existingProperties.length === 0) {
    logger(`[savePropertyToDb] Trying to find by current name: ${property.name}`)
    existingProperties = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.name, property.name),
          eq(properties.modelId, modelRecord.id!),
        ),
      )
      .limit(1)
    logger(`[savePropertyToDb] Found ${existingProperties.length} properties by current name`)
  }

  // Prepare property data
  const propertyData: Partial<NewPropertyRecord> = {
    name: property.name,
    modelId: modelRecord.id!,
    dataType: normalizeDataType(property.dataType),
  }
  
  // Preserve schemaFileId if we have it
  if (schemaFileId) {
    propertyData.schemaFileId = schemaFileId
  }

  // Handle ref property - create ref model if needed
  if (property.refModelName) {
    const refModel = await findOrCreateRefModelRecord(db, property.refModelName, modelRecord.id!)
    propertyData.refModelId = refModel.id
  } else if (property.refModelId) {
    propertyData.refModelId = property.refModelId
  } else {
    // If it's not a Relation type, ensure refModelId is null
    propertyData.refModelId = null
  }

  if (property.refValueType) {
    propertyData.refValueType = normalizeDataType(property.refValueType)
  } else {
    // If refValueType is not set, ensure it's null
    propertyData.refValueType = null
  }

  propertyData.required = property.required ?? false

  // Only when the context has storage settings: a context built without them (e.g. loaded before
  // they were stored) must not clear the row's.
  const storage = propertyStorageColumns(property)
  if (hasStorageSettings(storage)) {
    Object.assign(propertyData, storage)
  }

  if (existingProperties.length > 0) {
    // Property exists, update it with new values (including new name)
    // Set isEdited = true when property is edited
    const existingProperty = existingProperties[0]
    await db
      .update(properties)
      .set({
        ...propertyData,
        definition: propertyDefinitionColumn(property, existingProperty.definition),
        isEdited: true, // Mark as edited when saving changes
      })
      .where(eq(properties.id, existingProperty.id!))
    logger(`Updated property ${property.modelName}:${property._originalValues?.name || 'unknown'} -> ${property.name} in database`)
  } else {
    // Property doesn't exist, create it
    // Set isEdited = true for runtime-created properties
    // A conflict means the row already exists (concurrent addModelsToDb or another write): treat as success
    const inserted = await db
      .insert(properties)
      .values({
        ...propertyData,
        definition: propertyDefinitionColumn(property),
        isEdited: true, // Runtime-created properties are edited
      })
      .onConflictDoNothing()
      .returning({ id: properties.id })
    if (inserted.length > 0) {
      logger(`Created property ${property.modelName}:${property.name} in database`)
    } else {
      logger(`Property ${property.modelName}:${property.name} already exists (UNIQUE constraint), treating as success`)
    }
  }
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
  const appDb = BaseDb.getAppDb()

  if (!appDb) {
    return new Promise((resolve) => {
      setTimeout(async () => {
        resolve(await getAddressConfigFromDb())
      }, 500)
    })
  }

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
 * Write model to database and create model_schemas join entry
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
): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  
  // Find or create model record
  const modelRecords = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.schemaFileId, modelFileId))
    .limit(1)
  
  let modelId: number
  
  if (modelRecords.length === 0) {
    // Create new model record
    // Check again right before insert to avoid race conditions
    const doubleCheck = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, modelFileId))
      .limit(1)
    
    if (doubleCheck.length > 0) {
      // Another process created it, use existing
      modelId = doubleCheck[0].id!
      logger(`Model with schemaFileId "${modelFileId}" was created by another process, using existing record (id: ${modelId})`)
    } else {
      // DO NOTHING on conflict: addModelsToDb writes the same row during schema import, and a failed
      // insert is logged by sqlite-wasm even when caught.
      const newModel = await db
        .insert(modelsTable)
        .values({
          name: data.modelName,
          schemaFileId: modelFileId,
          isEdited: true, // Runtime-created models are edited
        })
        .onConflictDoNothing()
        .returning()
      if (newModel.length > 0) {
        modelId = newModel[0].id!
      } else {
        const existing = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.schemaFileId, modelFileId))
          .limit(1)
        if (existing.length === 0) {
          throw new Error(`Failed to create or find model "${data.modelName}" with schemaFileId "${modelFileId}"`)
        }
        modelId = existing[0].id!
        logger(`Found existing model with schemaFileId "${modelFileId}" (id: ${modelId}) after insert conflict`)
      }
    }
  } else {
    // Update existing model record
    modelId = modelRecords[0].id!
    const updates: Partial<NewModelRecord> = {}
    if (data.modelName !== modelRecords[0].name) {
      updates.name = data.modelName
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(modelsTable)
        .set(updates)
        .where(eq(modelsTable.id, modelId))
    }
  }
  
  // Validate that modelId and schemaId are valid before creating join entry
  if (!modelId || !Number.isInteger(modelId) || modelId <= 0) {
    throw new Error(`Invalid modelId: ${modelId}. Model record must be created successfully before creating join entry.`)
  }
  
  if (!data.schemaId || !Number.isInteger(data.schemaId) || data.schemaId <= 0) {
    throw new Error(`Invalid schemaId: ${data.schemaId}. Schema record must exist before creating join entry.`)
  }
  
  // Create model_schemas join entry
  // CRITICAL: This must happen AFTER the model record is fully saved and committed
  // The modelId comes from .returning() which ensures the record is committed
  const existingJoin = await db
    .select()
    .from(modelSchemas)
    .where(
      and(
        eq(modelSchemas.modelId, modelId),
        eq(modelSchemas.schemaId, data.schemaId)
      )
    )
    .limit(1)

  if (existingJoin.length === 0) {
    // Only provide modelId and schemaId - id is auto-increment and should not be included
    // Don't use type cast - let Drizzle infer the correct type without id
    
    // Verify both modelId and schemaId exist before inserting join record
    try {
      // Verify modelId exists
      const modelCheck = await db
        .select({ id: modelsTable.id })
        .from(modelsTable)
        .where(eq(modelsTable.id, modelId))
        .limit(1)
      
      if (modelCheck.length === 0) {
        throw new Error(`Model with id ${modelId} does not exist in database. Cannot create join record.`)
      }
      
      // Verify schemaId exists and get name/fileId for invalidation broadcast
      const schemaSchemaMod = await import('../seedSchema/SchemaSchema')
      const { schemas: schemasTable } = schemaSchemaMod
      const schemaCheck = await db
        .select({
          id: schemasTable.id,
          name: schemasTable.name,
          schemaFileId: schemasTable.schemaFileId,
        })
        .from(schemasTable)
        .where(eq(schemasTable.id, data.schemaId))
        .limit(1)
      
      if (schemaCheck.length === 0) {
        throw new Error(`Schema with id ${data.schemaId} does not exist in database. Cannot create join record.`)
      }
      
      logger(`Creating join record: modelId=${modelId}, schemaId=${data.schemaId} (both verified to exist)`)
      
      await linkModelToSchema(db, modelId, data.schemaId)
      // Notify React useModels so it can invalidate; live query over join often doesn't re-run when model_schemas is inserted.
      // Yield so the insert is visible to the refetch that will run when the broadcast is received.
      if (typeof BroadcastChannel !== 'undefined') {
        await new Promise((r) => setTimeout(r, 10))
        const row = schemaCheck[0]
        try {
          postBroadcast('seed-models-invalidate', {
            schemaName: row.name ?? undefined,
            schemaFileId: row.schemaFileId ?? undefined,
          })
        } catch (_) {}
      }
      logger(`Successfully created join record for model ${data.modelName} (id: ${modelId}) to schema (id: ${data.schemaId})`)
    } catch (error: any) {
      if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        logger(`FOREIGN KEY constraint failed when creating join record for model "${data.modelName}"`)
        logger(`modelId: ${modelId}, schemaId: ${data.schemaId}`)
        logger(`Error details:`, error)
        // Re-throw with more context
        throw new Error(`FOREIGN KEY constraint failed when creating join record for model "${data.modelName}" (modelId: ${modelId}, schemaId: ${data.schemaId}). ${error.message}`)
      }
      throw error
    }
  }
  
  // Write properties if provided
  if (data.properties) {
    for (const [propName, propData] of Object.entries(data.properties)) {
      // Check if property already exists in database
      const existingProps = await db
        .select()
        .from(properties)
        .where(
          and(
            eq(properties.name, propName),
            eq(properties.modelId, modelId)
          )
        )
        .limit(1)
      
      let propertyFileId: string
      if (existingProps.length > 0 && existingProps[0].schemaFileId) {
        // Use existing property's schemaFileId
        propertyFileId = existingProps[0].schemaFileId
        logger(`Using existing propertyFileId "${propertyFileId}" for property "${data.modelName}:${propName}"`)
      } else if (propData.id) {
        // Use provided ID
        propertyFileId = propData.id
      } else {
        // Generate random propertyFileId
        // IDs should be generated in the import process before calling writeModelToDb
        const { generateId } = await import('./generateId')
        propertyFileId = generateId()
        logger(`Generated propertyFileId "${propertyFileId}" for property "${data.modelName}:${propName}"`)
      }
      
      await writePropertyToDb(propertyFileId, {
        modelId,
        name: propName,
        ...propData,
      })
    }
  }
  
  logger(`Wrote model ${data.modelName} (${modelFileId}) to database`)
}

/**
 * Write property to database
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
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  
  // Find existing property by schemaFileId first (preferred for uniqueness)
  let existingProperties = await db
    .select()
    .from(properties)
    .where(eq(properties.schemaFileId, propertyFileId))
    .limit(1)
  
  // Fallback: find by modelId and name if not found by schemaFileId
  if (existingProperties.length === 0) {
    existingProperties = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.name, data.name),
          eq(properties.modelId, data.modelId),
        ),
      )
      .limit(1)
  }
  
  // Prepare property data
  const propertyData: Partial<NewPropertyRecord> = {
    name: data.name,
    modelId: data.modelId,
    dataType: normalizeDataType(data.dataType),
    schemaFileId: propertyFileId,
    ...(isEdited !== undefined && { isEdited }),
  }
  
  // Handle ref property - create ref model if needed
  // Check refModelName first, then ref (for backwards compatibility with schema files)
  const refModelName = data.refModelName || data.ref
  if (refModelName) {
    const refModel = await findOrCreateRefModelRecord(db, refModelName, data.modelId)
    propertyData.refModelId = refModel.id
  } else if (data.refModelId) {
    propertyData.refModelId = data.refModelId
  } else {
    // If it's not a Relation type, ensure refModelId is null
    propertyData.refModelId = null
  }
  
  if (data.refValueType) {
    propertyData.refValueType = normalizeDataType(data.refValueType)
  } else {
    // If refValueType is not set, ensure it's null
    propertyData.refValueType = null
  }

  // Only overwrite `required` when the caller knows it. The creation write's payload can lack it, and
  // defaulting to false here cleared the flag the schema import set (required relations became optional).
  if (data.required !== undefined) {
    propertyData.required = data.required
  }

  // Storage settings, like `required`, only when the caller has them: the creation write's payload
  // can lack them, and writing nulls would clear what the schema import stored.
  const storage = propertyStorageColumns(data)
  if (hasStorageSettings(storage)) {
    Object.assign(propertyData, storage)
  }
  
  if (existingProperties.length > 0) {
    // Property exists, update it with new values.
    // Use existing row id for WHERE (not name+modelId) so renames work: the row
    // may have the old name but we're updating to the new one.
    const existing = existingProperties[0]
    await db
      .update(properties)
      .set({ ...propertyData, definition: propertyDefinitionColumn(data, existing.definition) })
      .where(eq(properties.id, existing.id!))
    logger(`Updated property ${data.name} (${propertyFileId}) in database`)
  } else {
    // Property doesn't exist, create it
    // Double-check before insert to avoid race conditions
    const doubleCheck = await db
      .select()
      .from(properties)
      .where(eq(properties.schemaFileId, propertyFileId))
      .limit(1)
    
    if (doubleCheck.length > 0) {
      // Another process created it, update it instead
      await db
        .update(properties)
        .set({ ...propertyData, definition: propertyDefinitionColumn(data, doubleCheck[0].definition) })
        .where(eq(properties.id, doubleCheck[0].id!))
      logger(`Property with schemaFileId "${propertyFileId}" was created by another process, updated existing record`)
    } else {
      // DO NOTHING on conflict: addModelsToDb writes the same row during schema import, and a failed
      // insert is logged by sqlite-wasm even when caught.
      const inserted = await db
        .insert(properties)
        .values({ required: false, isEdited: false, ...propertyData, definition: propertyDefinitionColumn(data) })
        .onConflictDoNothing()
        .returning({ id: properties.id })
      if (inserted.length > 0) {
        logger(`Created property ${data.name} (${propertyFileId}) in database`)
      } else {
        const existing = await db
          .select()
          .from(properties)
          .where(eq(properties.schemaFileId, propertyFileId))
          .limit(1)
        if (existing.length === 0) {
          throw new Error(`Failed to create or find property "${data.name}" with schemaFileId "${propertyFileId}"`)
        }
        await db
          .update(properties)
          .set({ ...propertyData, definition: propertyDefinitionColumn(data, existing[0].definition) })
          .where(eq(properties.id, existing[0].id!))
        logger(`Found existing property with schemaFileId "${propertyFileId}" (id: ${existing[0].id}) after insert conflict, updated it`)
      }
    }
  }
}
