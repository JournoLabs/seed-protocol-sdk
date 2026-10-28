import { SchemaFileFormat } from '@/types/import'
import { generateId } from '@/helpers'
import { addSchemaToDb } from '@/helpers/db'
import { listLatestSchemaFiles, readSchemaFile } from '@/helpers/schema'
import { applySchemaFile, resolveSchemaRow, SCHEMA_FILE_FORMAT } from '@/helpers/schemaApply'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { and, eq, desc } from 'drizzle-orm'
import debug from 'debug'
import { evictionLog, type ActorBacked } from '@/helpers/entity/entityCache'
import { holdChild } from '@/helpers/entity/entityLifecycle'
import { INTERNAL_SCHEMA_IDS, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const logger = debug('seedSdk:schema:loadOrCreateSchema')

/**
 * Query model IDs (schemaFileId) from database for a given schema
 */
const getModelIdsForSchema = async (schemaId: number): Promise<string[]> => {
  const db = BaseDb.getAppDb()
  if (!db) {
    logger('Database not available, cannot query model IDs')
    return []
  }

  try {
    const modelRecords = await db
      .select({
        modelFileId: modelsTable.schemaFileId,
      })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaId))
    
    const modelIds = modelRecords
      .map((row: { modelFileId: string | null }) => row.modelFileId)
      .filter((id: string | null | undefined): id is string => id !== null && id !== undefined)
    
    logger(`Found ${modelIds.length} model IDs for schema (id: ${schemaId}): ${modelIds.join(', ')}`)
    return modelIds
  } catch (error) {
    logger(`Error querying model IDs for schema ${schemaId}:`, error)
    return []
  }
}

/**
 * The schema's unsaved local edits, from the rows' is_edited flags, as Schema `_editedProperties`
 * keys: `schema:models` for a model created at runtime, `<model>:<property>` for an edited or added
 * property. A load starts with them, so edits made while no instance held the schema still reach
 * the next saveNewVersion.
 */
const getEditedKeysForSchema = async (db: NonNullable<ReturnType<typeof BaseDb.getAppDb>>, schemaId: number): Promise<string[]> => {
  const editedModels = await db
    .select({ id: modelsTable.id })
    .from(modelSchemas)
    .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
    .where(and(eq(modelSchemas.schemaId, schemaId), eq(modelsTable.isEdited, true)))
    .limit(1)
  const editedProperties: Array<{ modelName: string; propertyName: string }> = await db
    .select({ modelName: modelsTable.name, propertyName: propertiesTable.name })
    .from(modelSchemas)
    .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
    .innerJoin(propertiesTable, eq(propertiesTable.modelId, modelsTable.id))
    .where(and(eq(modelSchemas.schemaId, schemaId), eq(propertiesTable.isEdited, true)))
  return [
    ...(editedModels.length > 0 ? ['schema:models'] : []),
    ...editedProperties.map(({ modelName, propertyName }) => `${modelName}:${propertyName}`),
  ]
}

/**
 * Load the schema's Model instances, held by `owner` (the loading Schema) so an app's unload of a
 * model doesn't drop it from `schema.models` while the schema is loaded.
 */
const createModelInstances = async (modelIds: string[], since: number, owner?: ActorBacked): Promise<void> => {
  if (modelIds.length === 0) {
    return
  }

  try {
    const mod = await import('../Model/Model')
    const Model = mod?.Model ?? (mod as { default?: unknown })?.default
    if (!Model) {
      logger('Model not available from dynamic import')
      return
    }
    const createPromises = modelIds.map(async (modelFileId) => {
      try {
        // Not if the schema was evicted (Schema.destroy, test cleanup) since this check started
        const model = await Model.createById(modelFileId, { since })
        if (model && owner) holdChild(owner, model, Model.cache)
        if (model) {
          logger(`Created/cached Model instance for modelFileId "${modelFileId}"`)
        }
      } catch (error) {
        logger(`Error creating Model instance for modelFileId "${modelFileId}": ${error}`)
      }
    })
    
    await Promise.all(createPromises)
    logger(`Finished creating/caching ${modelIds.length} Model instances`)
  } catch (error) {
    logger(`Error in createModelInstances: ${error}`)
  }
}

export type LoadedSchema = {
  schema: SchemaFileFormat
  schemaRecord: any
  /** File ids of the schema's models, whose Model instances are cached */
  modelIds: string[]
  loadedAt: number
  dbVersion: number
  dbUpdatedAt: number
  /** `_editedProperties` keys of the rows' unsaved local edits; the schema loads as a draft when any */
  editedKeys: string[]
  /** True when no row or file had this name and the schema was created */
  created: boolean
}

const findSchemaRow = async (db: any, schemaName: string) => {
  if (schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
    const [internal] = await db.select().from(schemas).where(eq(schemas.schemaFileId, INTERNAL_SCHEMA_IDS[0])).limit(1)
    if (internal) return internal
  }
  const [byName] = await db
    .select()
    .from(schemas)
    .where(eq(schemas.name, schemaName))
    .orderBy(desc(schemas.isDraft), desc(schemas.version))
    .limit(1)
  if (byName) return byName
  const [byFileId] = await db.select().from(schemas).where(eq(schemas.schemaFileId, schemaName)).limit(1)
  return byFileId
}

/**
 * Creates the schema that has no row or file: the bundled Seed Protocol schema, or an empty draft
 * (version 1, new id, no models).
 */
const createSchema = async (schemaName: string): Promise<{ schema: SchemaFileFormat; schemaRecord: any }> => {
  if (schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
    const internalSchema = await import('../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
    const { schemaFile, schemaRecord } = await applySchemaFile(internalSchema.default as SchemaFileFormat, {
      store: false,
    })
    return { schema: schemaFile, schemaRecord }
  }
  const now = new Date().toISOString()
  const schema: SchemaFileFormat = {
    $schema: SCHEMA_FILE_FORMAT,
    version: 1,
    id: generateId(),
    metadata: { name: schemaName, createdAt: now, updatedAt: now },
    models: {},
    enums: {},
    migrations: [{ version: 1, timestamp: now, description: 'Initial schema', changes: [] }],
  }
  const schemaRecord = await addSchemaToDb(
    {
      name: schemaName,
      version: schema.version,
      createdAt: new Date(now).getTime(),
      updatedAt: new Date(now).getTime(),
    },
    schema.id,
    JSON.stringify(schema, null, 2),
    true, // isDraft
    true, // isEdited: created at runtime
  )
  logger(`Created new draft schema ${schemaName} in database`)
  return { schema, schemaRecord }
}

/**
 * Loads the schema named `schemaName` (or with that file id): its row, drafts first, resolved by
 * resolveSchemaRow, with its models' instances cached. With no row, a version file of that name is
 * applied first; with neither, the schema is created. A failed read throws rather than creating
 * over the existing row.
 */
export async function loadOrCreateSchema(schemaName: string, owner?: ActorBacked): Promise<LoadedSchema> {
  const since = evictionLog.now()
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  if (!schemaName) throw new Error('Schema name is required')

  let row = await findSchemaRow(db, schemaName)
  let created: { schema: SchemaFileFormat; schemaRecord: any } | undefined
  if (!row) {
    // A version file with no row yet (written by another tool, or before this database)
    const file = (await listLatestSchemaFiles()).find((info) => info.name === schemaName)
    if (file) {
      const schemaFile = await readSchemaFile(file.filePath)
      if (!schemaFile) throw new Error(`Could not read schema file ${file.filePath}`)
      await applySchemaFile({ ...schemaFile, id: schemaFile.id ?? file.schemaFileId }, { store: false })
      row = await findSchemaRow(db, schemaName)
      if (!row) throw new Error(`Schema "${schemaName}" has no row after applying ${file.filePath}`)
    } else {
      created = await createSchema(schemaName)
    }
  }

  const loadedAt = Date.now()
  if (created) {
    const modelIds = Object.values(created.schema.models ?? {}).map((model) => model.id).filter(Boolean) as string[]
    return {
      ...created,
      modelIds,
      loadedAt,
      dbVersion: created.schema.version,
      dbUpdatedAt: loadedAt,
      editedKeys: [],
      created: true,
    }
  }

  logger(`Found schema record: name="${row.name}", isDraft=${row.isDraft}`)
  const { schema } = await resolveSchemaRow(row, db)
  const modelIds = row.id ? await getModelIdsForSchema(row.id) : []
  const editedKeys = row.id ? await getEditedKeysForSchema(db, row.id) : []
  await createModelInstances(modelIds, since, owner)
  return {
    schema,
    schemaRecord: row,
    modelIds,
    loadedAt,
    dbVersion: row.version || schema.version,
    dbUpdatedAt: row.updatedAt || loadedAt,
    editedKeys,
    created: false,
  }
}
