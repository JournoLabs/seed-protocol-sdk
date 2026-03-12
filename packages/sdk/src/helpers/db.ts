import {
  appState,
  models as modelsTable,
  NewModelRecord,
  NewPropertyRecord,
  properties,
  PropertyType,
} from '@/seedSchema'
import { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { DbQueryResult, ModelDefinitions, ResultObject } from '@/types'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import { and, eq, isNull, SQL } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { SchemaType, schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas, ModelSchemaType } from '@/seedSchema/ModelSchemaSchema'
import { InferInsertModel } from 'drizzle-orm'
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine'
// Dynamic import to break circular dependency: Model -> ... -> helpers/db -> ModelProperty -> ... -> Model
// import { ModelProperty } from '@/ModelProperty/ModelProperty'
import debug from 'debug'

const logger = debug('seedSdk:helpers:db')

export const escapeSqliteString = (value: string): string => {
  if (typeof value !== 'string') {
    throw new Error(
      `Value must be a string, instead got: ${JSON.stringify(value)}`,
    )
  }
  return value.replace(/'/g, "''")
}
export const getObjectForRow = (row: any): ResultObject => {
  const obj: ResultObject = {}

  row.columnNames.forEach((colName: string, index: number) => {
    const value = row.row[index]
    if (typeof value !== 'string') {
      obj[colName] = row.row[index]
      return
    }

    // Try to parse the value as JSON
    try {
      obj[colName] = JSON.parse(value)
    } catch (e) {
      // If it fails, just set the value as a string
      obj[colName] = value
    }
  })

  return obj
}
export const getSqlResultObject = (
  queryResult: DbQueryResult,
): ResultObject | ResultObject[] | undefined => {
  if (!queryResult || !queryResult.rows || queryResult.rows.length === 0) {
    return
  }

  let obj: ResultObject | ResultObject[] | undefined

  if (queryResult.rows.length === 1) {
    obj = getObjectForRow(queryResult.rows[0])
  }

  if (queryResult.rows.length > 1) {
    obj = queryResult.rows.reduce((acc: ResultObject[], row: any) => {
      const rowObj = getObjectForRow(row)

      acc.push(rowObj)
      return acc
    }, [] as ResultObject[])
  }

  return obj
}
export const createOrUpdate = async <T>(
  db: BetterSQLite3Database | SqliteRemoteDatabase,
  table: SQLiteTableWithColumns<any>,
  values: Partial<Record<keyof T, T[keyof T]>>,
) => {
  const startTime = Date.now()

  const valueFilters: SQL[] = []

  const propertiesToExcludeFromDb = ['ref']

  const safeValues = Object.keys(values).reduce(
    (acc, key) => {
      if (!propertiesToExcludeFromDb.includes(key)) {
        acc[key] = values[key as string & keyof T]
      }
      return acc
    },
    {} as Record<string, unknown>,
  )

  for (const [key, value] of Object.entries(safeValues)) {
    let finalValue = value
    if (key === 'TObject') {
      continue
    }
    if (typeof value === 'object') {
      finalValue = JSON.stringify(value)
    }
    const column = table[key]
    if (!column) {
      throw new Error(`Column not found for ${key}`)
    }
    if (typeof finalValue === 'undefined') {
      finalValue = null
    }
    if (finalValue === null) {
      valueFilters.push(isNull(table[key]))
      continue
    }
    valueFilters.push(eq(table[key], finalValue))
  }

  const doneWithFilters = Date.now()

  // console.log('valueFilters:', valueFilters)

  // for ( const filter of valueFilters ) {
  //   console.log('filter:', Object.keys(filter))
  // }

  // Build a query to find the record based on properties
  const existingRecords = await db
    .select()
    .from(table)
    .where(and(...valueFilters))

  const doneWithExistingRecords = Date.now()

  if (existingRecords.length > 1) {
    throw new Error('Multiple records found')
  }

  if (existingRecords.length > 0) {
    // If record exists, update it
    await db
      .update(table)
      .set(safeValues)
      .where(and(...valueFilters))

    const doneWithUpdate = Date.now()

    return existingRecords[0] as T
  } else {
    // If no record exists, create a new one
    const newRecord = await db.insert(table).values(safeValues).returning()
    return newRecord[0] as T
  }
}

/**
 * Searches the database for an existing schema by schemaFileId (preferred) or name and creates it if it doesn't exist
 * @param schema - The schema to add to the database
 * @param schemaFileId - Optional schemaFileId from JSON file for change tracking
 * @param schemaData - Optional full schema content as JSON string (SchemaFileFormat)
 * @param isDraft - Optional flag indicating if schema is in draft state (default: false)
 * @param isEdited - Optional flag indicating if schema has been edited locally (default: false)
 * @returns The schema record (either existing or newly created)
 */
export const addSchemaToDb = async (
  schema: Omit<SchemaType, 'id' | 'schemaFileId' | 'schemaData' | 'isDraft' | 'isEdited'>,
  schemaFileId?: string,
  schemaData?: string,
  isDraft?: boolean,
  isEdited?: boolean,
): Promise<typeof schemas.$inferSelect> => {
  const db = BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

  // First, try to find existing schema by schemaFileId (preferred for change tracking)
  if (schemaFileId) {
    const existingByFileId = await db
      .select()
      .from(schemas)
      .where(eq(schemas.schemaFileId, schemaFileId))
      .limit(1)

    if (existingByFileId.length > 0) {
      // Update fields if provided
      const updates: Partial<typeof schemas.$inferInsert> = {}
      if (schemaFileId && !existingByFileId[0].schemaFileId) {
        updates.schemaFileId = schemaFileId
      }
      // Always update name if it's different (handles name changes)
      if (schema.name && existingByFileId[0].name !== schema.name) {
        updates.name = schema.name
      }
      if (schemaData !== undefined) {
        updates.schemaData = schemaData
      }
      if (schema.version !== undefined && existingByFileId[0].version !== schema.version) {
        updates.version = schema.version
      }
      if (isDraft !== undefined && existingByFileId[0].isDraft !== isDraft) {
        updates.isDraft = isDraft
      }
      if (isEdited !== undefined && existingByFileId[0].isEdited !== isEdited) {
        updates.isEdited = isEdited
      }
      if (schema.updatedAt && existingByFileId[0].updatedAt !== schema.updatedAt) {
        updates.updatedAt = schema.updatedAt
      }
      if (Object.keys(updates).length > 0) {
        await db
          .update(schemas)
          .set(updates)
          .where(eq(schemas.id, existingByFileId[0].id!))
        return { ...existingByFileId[0], ...updates }
      }
      return existingByFileId[0]
    }
  }

  // For drafts, check if there's an existing draft by name (not by schemaFileId)
  if (isDraft === true) {
    const existingDrafts = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, schema.name))
      .limit(1)

    if (existingDrafts.length > 0 && existingDrafts[0].isDraft === true) {
      // Update existing draft
      const updates: Partial<typeof schemas.$inferInsert> = {}
      // Update schemaFileId if provided and different from existing
      if (schemaFileId && existingDrafts[0].schemaFileId !== schemaFileId) {
        updates.schemaFileId = schemaFileId
      }
      if (schemaData !== undefined) {
        updates.schemaData = schemaData
      }
      if (schema.version !== undefined) {
        updates.version = schema.version
      }
      updates.updatedAt = schema.updatedAt || Date.now()
      
      if (Object.keys(updates).length > 0) {
        await db
          .update(schemas)
          .set(updates)
          .where(eq(schemas.id, existingDrafts[0].id!))
        return { ...existingDrafts[0], ...updates }
      }
      return existingDrafts[0]
    }
  }

  // Fallback: Search for existing schema by name
  // BUT: If we have a schemaFileId, also check if any record with that schemaFileId exists
  // (in case the name changed but we're looking up by the new name)
  if (schemaFileId) {
    // Double-check by schemaFileId - maybe the name changed and we're looking up by new name
    const doubleCheckByFileId = await db
      .select()
      .from(schemas)
      .where(eq(schemas.schemaFileId, schemaFileId))
      .limit(1)
    
    if (doubleCheckByFileId.length > 0) {
      // Found by schemaFileId - update it (name might have changed)
      const updates: Partial<typeof schemas.$inferInsert> = {}
      // Always update name if it's different (handles name changes)
      if (schema.name && doubleCheckByFileId[0].name !== schema.name) {
        updates.name = schema.name
      }
      if (schemaData !== undefined) {
        updates.schemaData = schemaData
      }
      if (schema.version !== undefined && doubleCheckByFileId[0].version !== schema.version) {
        updates.version = schema.version
      }
      if (isDraft !== undefined && doubleCheckByFileId[0].isDraft !== isDraft) {
        updates.isDraft = isDraft
      }
      if (isEdited !== undefined && doubleCheckByFileId[0].isEdited !== isEdited) {
        updates.isEdited = isEdited
      }
      if (schema.updatedAt && doubleCheckByFileId[0].updatedAt !== schema.updatedAt) {
        updates.updatedAt = schema.updatedAt
      }
      if (Object.keys(updates).length > 0) {
        await db
          .update(schemas)
          .set(updates)
          .where(eq(schemas.id, doubleCheckByFileId[0].id!))
        return { ...doubleCheckByFileId[0], ...updates }
      }
      return doubleCheckByFileId[0]
    }
  }
  
  // Final fallback: Search by name (only if no schemaFileId or schemaFileId lookup failed)
  // If isDraft is explicitly false, first try to find non-draft, but also check for drafts
  // to handle the case where a draft exists and we're loading a non-draft version
  let existingSchemas = await db
    .select()
    .from(schemas)
    .where(
      isDraft === false
        ? and(eq(schemas.name, schema.name), eq(schemas.isDraft, false))
        : eq(schemas.name, schema.name)
    )
    .limit(1)

  // If isDraft is false and we didn't find a non-draft, check for a draft with the same name
  // This handles the case where a draft was created first and we're now loading the non-draft version
  if (isDraft === false && existingSchemas.length === 0) {
    const draftSchemas = await db
      .select()
      .from(schemas)
      .where(and(eq(schemas.name, schema.name), eq(schemas.isDraft, true)))
      .limit(1)
    
    if (draftSchemas.length > 0) {
      // Found a draft - we'll update it to non-draft below
      logger(`Found draft schema "${schema.name}" with schemaFileId "${draftSchemas[0].schemaFileId}", will update to non-draft with schemaFileId "${schemaFileId}"`)
      existingSchemas = draftSchemas
    }
  }

  if (existingSchemas.length > 0) {
    // Update fields if provided
    const updates: Partial<typeof schemas.$inferInsert> = {}
    // Update schemaFileId if provided and different from existing (or if existing doesn't have one or is null)
    // This is important for preserving IDs from schema files when drafts exist
    // BUT: Don't overwrite a non-draft schema's schemaFileId with a new generated one
    // This prevents loadOrCreateSchema from overwriting correct IDs from fixture files
    if (schemaFileId && existingSchemas[0].schemaFileId !== schemaFileId) {
      // Only update if:
      // 1. Existing schema is a draft (can be updated)
      // 2. Existing schema has no schemaFileId (should be set)
      // 3. We're explicitly setting isDraft to false (updating from draft to non-draft)
      const shouldUpdate = existingSchemas[0].isDraft === true || 
                          !existingSchemas[0].schemaFileId || 
                          (isDraft === false && existingSchemas[0].isDraft === true)
      
      if (shouldUpdate) {
        logger(`Updating schemaFileId from "${existingSchemas[0].schemaFileId}" to "${schemaFileId}" for schema "${schema.name}"`)
        updates.schemaFileId = schemaFileId
      } else {
        logger(`Preserving existing schemaFileId "${existingSchemas[0].schemaFileId}" for non-draft schema "${schema.name}" (new schemaFileId "${schemaFileId}" would overwrite it)`)
      }
    }
    // Always update name if it's different (handles name changes)
    if (schema.name && existingSchemas[0].name !== schema.name) {
      updates.name = schema.name
    }
    if (schemaData !== undefined) {
      updates.schemaData = schemaData
    }
    if (schema.version !== undefined && existingSchemas[0].version !== schema.version) {
      updates.version = schema.version
    }
    // If isDraft is explicitly false and we found a draft, update it to non-draft
    if (isDraft === false && existingSchemas[0].isDraft === true) {
      updates.isDraft = false
    } else if (isDraft !== undefined && existingSchemas[0].isDraft !== isDraft) {
      updates.isDraft = isDraft
    }
    if (isEdited !== undefined && existingSchemas[0].isEdited !== isEdited) {
      updates.isEdited = isEdited
    }
    if (schema.updatedAt && existingSchemas[0].updatedAt !== schema.updatedAt) {
      updates.updatedAt = schema.updatedAt
    }
    if (Object.keys(updates).length > 0) {
      logger(`Applying updates to schema "${schema.name}" (id: ${existingSchemas[0].id}):`, Object.keys(updates))
      await db
        .update(schemas)
        .set(updates)
        .where(eq(schemas.id, existingSchemas[0].id!))
      const updated = { ...existingSchemas[0], ...updates }
      logger(`Schema "${schema.name}" updated. New schemaFileId: "${updated.schemaFileId}", isDraft: ${updated.isDraft}`)
      return updated
    }
    logger(`No updates needed for schema "${schema.name}" (id: ${existingSchemas[0].id})`)
    return existingSchemas[0]
  }

  // Create schema if it doesn't exist
  type NewSchemaRecord = InferInsertModel<typeof schemas>
  const newSchema = await db.insert(schemas).values({
    name: schema.name,
    version: schema.version,
    schemaFileId: schemaFileId || null,
    schemaData: schemaData || null,
    isDraft: isDraft ?? false,
    isEdited: isEdited ?? false,
    createdAt: schema.createdAt,
    updatedAt: schema.updatedAt,
  } as NewSchemaRecord).returning()

  // Notify React useSchemas so it can invalidate; live query often doesn't re-run when schemas table is inserted.
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      await new Promise((r) => setTimeout(r, 10))
      new BroadcastChannel('seed-schemas-invalidate').postMessage({})
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
): Promise<NewModelRecord> => {
  const db = BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

  const { schemas: schemasTable } = await import('../seedSchema/SchemaSchema')

  // Find the model by old name, optionally scoped by schema
  let existingModels: { id: number; name: string | null; schemaFileId: string | null; isEdited: boolean | null }[]
  if (schemaNameOrId !== undefined) {
    if (typeof schemaNameOrId === 'number') {
      const rows = await db
        .select({
          id: modelsTable.id,
          name: modelsTable.name,
          schemaFileId: modelsTable.schemaFileId,
          isEdited: modelsTable.isEdited,
        })
        .from(modelsTable)
        .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
        .where(
          and(
            eq(modelsTable.name, oldName),
            eq(modelSchemas.schemaId, schemaNameOrId),
          ),
        )
        .limit(1)
      existingModels = rows
    } else {
      const rows = await db
        .select({
          id: modelsTable.id,
          name: modelsTable.name,
          schemaFileId: modelsTable.schemaFileId,
          isEdited: modelsTable.isEdited,
        })
        .from(modelsTable)
        .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
        .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
        .where(
          and(
            eq(modelsTable.name, oldName),
            eq(schemasTable.name, schemaNameOrId),
          ),
        )
        .limit(1)
      existingModels = rows
    }
  } else {
    existingModels = await db
      .select({
        id: modelsTable.id,
        name: modelsTable.name,
        schemaFileId: modelsTable.schemaFileId,
        isEdited: modelsTable.isEdited,
      })
      .from(modelsTable)
      .where(eq(modelsTable.name, oldName))
      .limit(1)
  }

  if (existingModels.length === 0) {
    if (schemaNameOrId !== undefined) {
      throw new Error(
        `Model "${oldName}" not found in schema "${schemaNameOrId}"`,
      )
    }
    // Backward compat: model doesn't exist, create it with new name
    const newModel = await db.insert(modelsTable).values({ name: newName }).returning()
    return newModel[0] as NewModelRecord
  }

  const modelToRename = existingModels[0]

  // Check if a model with the new name already exists in the same schema
  let existingWithNewName: { id: number; name: string | null; schemaFileId: string | null; isEdited: boolean | null }[]
  if (schemaNameOrId !== undefined) {
    if (typeof schemaNameOrId === 'number') {
      existingWithNewName = await db
        .select({
          id: modelsTable.id,
          name: modelsTable.name,
          schemaFileId: modelsTable.schemaFileId,
          isEdited: modelsTable.isEdited,
        })
        .from(modelsTable)
        .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
        .where(
          and(
            eq(modelsTable.name, newName),
            eq(modelSchemas.schemaId, schemaNameOrId),
          ),
        )
        .limit(1)
    } else {
      existingWithNewName = await db
        .select({
          id: modelsTable.id,
          name: modelsTable.name,
          schemaFileId: modelsTable.schemaFileId,
          isEdited: modelsTable.isEdited,
        })
        .from(modelsTable)
        .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
        .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
        .where(
          and(
            eq(modelsTable.name, newName),
            eq(schemasTable.name, schemaNameOrId),
          ),
        )
        .limit(1)
    }
  } else {
    existingWithNewName = await db
      .select({
        id: modelsTable.id,
        name: modelsTable.name,
        schemaFileId: modelsTable.schemaFileId,
        isEdited: modelsTable.isEdited,
      })
      .from(modelsTable)
      .where(eq(modelsTable.name, newName))
      .limit(1)
  }

  if (existingWithNewName.length > 0) {
    // New name already exists in this schema, return it
    return existingWithNewName[0] as NewModelRecord
  }

  // Update the model name
  await db
    .update(modelsTable)
    .set({ name: newName })
    .where(eq(modelsTable.id, modelToRename.id!))

  return { ...modelToRename, name: newName } as NewModelRecord
}

/**
 * Check if a property has been locally edited (has unsaved changes)
 * This checks both the in-memory cache (for current session) and the database
 * (for persistence across reloads) by comparing database values with schema file values.
 * @param modelName - The name of the model
 * @param propertyName - The name of the property
 * @param schemaFileValue - Optional schema file value to compare against database
 * @returns true if the property is marked as edited, false otherwise
 */
async function checkIfPropertyIsEdited(
  modelName: string,
  propertyName: string,
  schemaFileValue?: { dataType?: string; ref?: string; refValueType?: string; required?: boolean },
): Promise<boolean> {
  try {
    const cacheKey = `${modelName}:${propertyName}`
    
    // First, check the in-memory cache (for current session edits)
    // Robust dynamic import for consumer re-bundling (named or default export)
    const mod = await import('../ModelProperty/ModelProperty')
    const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
    if (!ModelProperty) {
      logger('ModelProperty not available from dynamic import')
      return false
    }
    type ModelPropertyInstance = InstanceType<typeof ModelProperty>
    const ModelPropertyClass = ModelProperty as typeof ModelProperty & {
      instanceCache: Map<string, { instance: ModelPropertyInstance; refCount: number }>
    }
    
    const cachedInstance = ModelPropertyClass.instanceCache.get(cacheKey)
    
    if (cachedInstance) {
      const modelProperty = cachedInstance.instance
      const context = modelProperty.getService().getSnapshot().context
      
      // Check if the property is marked as edited in memory
      if (context._isEdited === true) {
        return true
      }
    }
    
    // If not in cache, check the database by comparing with schema file value
    if (schemaFileValue) {
      const db = BaseDb.getAppDb()
      if (db) {
        // Find the model
        const modelRecords = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, modelName))
          .limit(1)
        
        if (modelRecords.length > 0) {
          const modelRecord = modelRecords[0]
          
          // Find the property in the database
          const propertyRecords = await db
            .select()
            .from(properties)
            .where(
              and(
                eq(properties.name, propertyName),
                eq(properties.modelId, modelRecord.id!),
              ),
            )
            .limit(1)
          
          if (propertyRecords.length > 0) {
            const dbProperty = propertyRecords[0]
            
            // Compare database value with schema file value
            // If they differ, the property has been edited
            if (dbProperty.dataType !== schemaFileValue.dataType) {
              logger(`Property ${modelName}:${propertyName} has been edited (dataType differs: DB=${dbProperty.dataType}, Schema=${schemaFileValue.dataType})`)
              return true
            }
            
            // Check refModelId if it's a relation
            if (schemaFileValue.ref) {
              const refModelRecords = await db
                .select()
                .from(modelsTable)
                .where(eq(modelsTable.name, schemaFileValue.ref))
                .limit(1)
              
              if (refModelRecords.length > 0) {
                const expectedRefModelId = refModelRecords[0].id
                if (dbProperty.refModelId !== expectedRefModelId) {
                  logger(`Property ${modelName}:${propertyName} has been edited (refModelId differs)`)
                  return true
                }
              }
            } else if (dbProperty.refModelId !== null) {
              // Schema file has no ref, but DB has one
              logger(`Property ${modelName}:${propertyName} has been edited (refModelId differs)`)
              return true
            }
            
            // Check refValueType
            if (dbProperty.refValueType !== (schemaFileValue.refValueType || null)) {
              logger(`Property ${modelName}:${propertyName} has been edited (refValueType differs)`)
              return true
            }

            // Check required (for Relation/Image properties)
            if (schemaFileValue.required !== undefined) {
              const schemaRequired = !!schemaFileValue.required
              const dbRequired = dbProperty.required === true
              if (dbRequired !== schemaRequired) {
                logger(`Property ${modelName}:${propertyName} has been edited (required differs: DB=${dbRequired}, Schema=${schemaRequired})`)
                return true
              }
            }
          }
        }
      }
    }
    
    return false
  } catch (error) {
    // If we can't check, assume it's not edited to be safe
    logger('Error checking if property is edited:', error)
    return false
  }
}

/**
 * Adds models and their properties to the database.
 * Optionally connects models to a schema via join records.
 * @param models - The model definitions to add
 * @param schema - Optional schema to connect models to
 * @param modelRenames - Optional map of old model names to new model names for handling renames
 * @param schemaFileData - Optional object containing schemaFileId mappings from JSON file: { schemaFileId, modelFileIds: Map<modelName, id>, propertyFileIds: Map<modelName, Map<propertyName, id>> }
 */
export const addModelsToDb = async (
  models: ModelDefinitions,
  schema?: SchemaType,
  modelRenames?: Map<string, string>,
  schemaFileData?: {
    schemaFileId?: string
    modelFileIds?: Map<string, string>
    propertyFileIds?: Map<string, Map<string, string>>
  },
) => {
  const db = BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

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
      schemaRecord = await addSchemaToDb(schema, schemaFileData?.schemaFileId)
      logger(`Created/found schema record with id: ${schemaRecord.id}`)
    }
  }

  // Handle model renames first if provided
  if (modelRenames && schemaRecord) {
    const schemaNameOrId = schemaRecord.name ?? schemaRecord.id
    for (const [oldName, newName] of modelRenames.entries()) {
      await renameModelInDb(oldName, newName, schemaNameOrId)
    }
  }

  // Search for all models by schemaFileId (preferred) or name and create them if they don't exist
  const modelRecords = new Map<string, NewModelRecord>()
  const modelProcessingErrors: Array<{ modelName: string; error: string }> = []
  
  for (const [modelName, modelClass] of Object.entries(models)) {
    try {
      const modelFileId = schemaFileData?.modelFileIds?.get(modelName)
    
    // First try to find by schemaFileId if available
    let modelRecord: NewModelRecord | undefined
    if (modelFileId) {
      const existingByFileId = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)
      
      if (existingByFileId.length > 0) {
        modelRecord = existingByFileId[0] as NewModelRecord
        // Update name if it changed
        if (modelRecord.name !== modelName) {
          await db
            .update(modelsTable)
            .set({ name: modelName })
            .where(eq(modelsTable.id, modelRecord.id!))
          modelRecord = { ...modelRecord, name: modelName }
        }
      }
    }
    
    // Fallback to finding by name, but ONLY if we don't have a modelFileId
    // If we have a modelFileId, we should create a new record with it (don't reuse existing by name)
    if (!modelRecord) {
      if (modelFileId) {
        // We have a modelFileId but no existing record - create new with the correct schemaFileId
        // Double-check before insert to avoid race conditions
        const doubleCheck = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.schemaFileId, modelFileId))
          .limit(1)
        
        if (doubleCheck.length > 0) {
          modelRecord = doubleCheck[0] as NewModelRecord
          logger(`Model with schemaFileId "${modelFileId}" was created by another process, using existing record`)
        } else {
          try {
            const newModel = await db.insert(modelsTable).values({
              name: modelName,
              schemaFileId: modelFileId,
              isEdited: false, // Set isEdited = false when loading from schema file
            }).returning()
            modelRecord = newModel[0] as NewModelRecord
            logger(`Created new model "${modelName}" with schemaFileId "${modelFileId}"`)
          } catch (error: any) {
            // Handle unique constraint violation
            if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.message?.includes('UNIQUE constraint')) {
              logger(`Unique constraint violation for schemaFileId "${modelFileId}", attempting to find existing model`)
              const existing = await db
                .select()
                .from(modelsTable)
                .where(eq(modelsTable.schemaFileId, modelFileId))
                .limit(1)
              if (existing.length > 0) {
                modelRecord = existing[0] as NewModelRecord
                logger(`Found existing model with schemaFileId "${modelFileId}" (id: ${modelRecord.id}) after constraint violation`)
              } else {
                throw new Error(`Failed to create or find model "${modelName}" with schemaFileId "${modelFileId}": ${error.message}`)
              }
            } else {
              throw error
            }
          }
        }
      } else {
        // No modelFileId - use createOrUpdate (finds by name or creates)
        modelRecord = await createOrUpdate<NewModelRecord>(db, modelsTable, {
          name: modelName,
        })
      }
    }
    
    // Update schemaFileId if we have it and it's not set (or if it's different)
    if (modelFileId && modelRecord.schemaFileId !== modelFileId) {
      // Check if another model already has this schemaFileId
      const existingWithFileId = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.schemaFileId, modelFileId))
        .limit(1)
      
      if (existingWithFileId.length > 0 && existingWithFileId[0].id !== modelRecord.id) {
        logger(`WARNING: Model "${modelName}" (id: ${modelRecord.id}) conflicts with existing model "${existingWithFileId[0].name}" (id: ${existingWithFileId[0].id}) both trying to use schemaFileId "${modelFileId}"`)
        // Don't update - keep existing assignment to avoid conflicts
      } else {
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
    const modelContext = (modelClass as any)._getSnapshotContext?.() || {}
    const contextProperties = modelContext.properties || {}
    // When models are created from JSON, properties are stored as _pendingPropertyDefinitions
    const pendingProperties = modelContext._pendingPropertyDefinitions || {}
    
    // If context properties are empty, try modelClass.properties (for backward compatibility)
    // but convert ModelProperty instances to object format
    let schema: { [propertyName: string]: any } = {}
    if (Object.keys(contextProperties).length > 0) {
      schema = contextProperties
    } else if (Object.keys(pendingProperties).length > 0) {
      // Use pending property definitions (from JSON import)
      schema = pendingProperties
    } else {
      const modelHelpersMod = await import('./model')
      const { modelPropertiesToObject } = modelHelpersMod
      const modelProperties = modelClass.properties || []
      schema = modelPropertiesToObject(modelProperties)
    }
    const schemaPropertyNames = new Set(Object.keys(schema))

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
      
      // If no propertyFileId from map, generate a random ID
      // IDs should be generated in the import process before calling addModelsToDb
      if (!propertyFileId) {
        const helpersIndexMod = await import('./index')
        const { generateId } = helpersIndexMod
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
        dataType: propertyValues.dataType,
        schemaFileId: propertyFileId || null,
        required: propertyValues.required ?? false,
      }

      // Handle ref property - create ref model if needed
      // Check both ref and refModelName (refModelName is set by createModelFromJson)
      let expectedRefModelId: number | null = null
      const refModelName = propertyValues.ref || propertyValues.refModelName
      if (refModelName) {
        const refModel = await createOrUpdate<NewModelRecord>(
          db,
          modelsTable,
          {
            name: refModelName,
          },
        )
        propertyData.refModelId = refModel.id ?? null
        expectedRefModelId = refModel.id ?? null
      } else {
        // If it's not a Relation type, ensure refModelId is null
        propertyData.refModelId = null
      }

      if (propertyValues.refValueType) {
        propertyData.refValueType = propertyValues.refValueType
      } else {
        // If refValueType is not set, ensure it's null
        propertyData.refValueType = null
      }

      // If not found by name, try to find by position/characteristics (for renamed properties)
      if (!existingProperty) {
        // Look for unmatched DB properties that could be this renamed property
        // Match by: same dataType, same refModelId (if applicable), and not matching any schema property name
        const potentialMatches = allDbProperties.filter((p: PropertyType) => 
          !matchedDbPropertyIds.has(p.id!) &&
          !schemaPropertyNames.has(p.name) && // This DB property doesn't match any schema property name
          p.dataType === propertyValues.dataType &&
          (expectedRefModelId === null 
            ? p.refModelId === null 
            : p.refModelId === expectedRefModelId) &&
          (propertyValues.refValueType 
            ? p.refValueType === propertyValues.refValueType 
            : p.refValueType === null)
        )
        
        // If we find exactly one match, or if we're at the same position index, use it
        // For now, use the first match (could be enhanced to use position more precisely)
        if (potentialMatches.length > 0) {
          const matchedProperty = potentialMatches[0]
          existingProperty = matchedProperty
          logger(
            `Found renamed property: ${modelName}:${matchedProperty.name} -> ${propertyName} (matched by characteristics)`,
          )
        }
      }

      if (existingProperty) {
        // Mark this DB property as matched
        matchedDbPropertyIds.add(existingProperty.id!)
        
        // Property exists - check if it's been locally edited before updating
        // Pass the schema file value for comparison
        const isPropertyEdited = await checkIfPropertyIsEdited(
          modelName,
          existingProperty.name, // Use the DB property name for checking
          {
            dataType: propertyValues.dataType,
            ref: propertyValues.ref,
            refValueType: propertyValues.refValueType,
            required: propertyValues.required,
          },
        )
        
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
        if (existingProperty.isEdited === true) {
          // Preserve isEdited = true if property was locally edited
          // Don't overwrite it with false from schema file
          delete updateData.isEdited
        } else {
          // Set isEdited = false when loading from schema file
          updateData.isEdited = false
        }
        await db
          .update(properties)
          .set(updateData)
          .where(eq(properties.id, existingProperty.id!))
      } else {
        // Property doesn't exist, create it with schemaFileId
        // Set isEdited = false when loading from schema file
        const propertyDataWithIsEdited = {
          ...propertyData,
          isEdited: false,
        }
        logger(`Creating new property ${modelName}:${propertyName} with schemaFileId: ${propertyData.schemaFileId}`)
        try {
          await db.insert(properties).values(propertyDataWithIsEdited)
        } catch (insertError: any) {
          // Treat UNIQUE constraint as success - property already exists (e.g. from concurrent addModelsToDb call)
          if (insertError?.code === 'SQLITE_CONSTRAINT_UNIQUE' || insertError?.message?.includes('UNIQUE constraint')) {
            logger(`Property ${modelName}:${propertyName} already exists (UNIQUE constraint), treating as success`)
          } else {
            throw insertError
          }
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
    // Check for existing records first since there's no unique constraint
    const createdJoinEntries: string[] = []
    const existingJoinEntries: string[] = []
    
    for (const [modelName, modelRecord] of modelRecords.entries()) {
      if (!modelRecord.id) {
        logger(`Skipping join table entry for ${modelName}: model record has no id`)
        continue
      }
      
      const existingJoinRecords = await db
        .select()
        .from(modelSchemas)
        .where(
          and(
            eq(modelSchemas.modelId, modelRecord.id),
            eq(modelSchemas.schemaId, schemaRecord.id),
          ),
        )
        .limit(1)

      if (existingJoinRecords.length === 0) {
        // Only provide modelId and schemaId - id is auto-increment and should not be included
        // Don't use type cast - let Drizzle infer the correct type without id
        await db.insert(modelSchemas).values({
          modelId: modelRecord.id,
          schemaId: schemaRecord.id,
        })
        logger(`Created join table entry for model ${modelName} (id: ${modelRecord.id}) to schema (id: ${schemaRecord.id})`)
        createdJoinEntries.push(modelName)
      } else {
        logger(`Join table entry already exists for model ${modelName} to schema (id: ${schemaRecord.id})`)
        existingJoinEntries.push(modelName)
      }
    }
    
    // Verify all models are linked (important for debugging)
    const allLinkedModels = await db
      .select({
        modelId: modelSchemas.modelId,
        modelName: modelsTable.name,
      })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaRecord.id))
    
    const linkedModelNames = allLinkedModels.map((m: any) => m.modelName).filter(Boolean)
  } else if (schemaRecord && !schemaRecord.id) {
    logger(`Warning: schemaRecord provided but has no id, cannot create join table entries`)
  }
}

/**
 * Loads models from the database for a given schema by querying the model_schemas join table.
 * This ensures that models added to the database (via model_schemas) are included even if
 * they're not in the schemaData JSON.
 * @param schemaId - The ID of the schema record in the database
 * @returns A map of model names to model data (compatible with SchemaFileFormat.models)
 */
export const loadModelsFromDbForSchema = async (
  schemaId: number,
): Promise<{ [modelName: string]: any }> => {
  const db = BaseDb.getAppDb()
  if (!db) {
    logger('Database not found, cannot load models from DB')
    return {}
  }

  try {
    // Query model_schemas join table to find all models linked to this schema
    const modelSchemaRecords = await db
      .select({
        modelId: modelSchemas.modelId,
        modelName: modelsTable.name,
      })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaId))

    const models: { [modelName: string]: any } = {}

    // For each model, load its properties
    for (const { modelId, modelName } of modelSchemaRecords) {
      if (!modelId || !modelName) continue

      // Get all properties for this model
      const propertyRecords = await db
        .select()
        .from(properties)
        .where(eq(properties.modelId, modelId))

      // Reconstruct properties object
      const modelProperties: { [propertyName: string]: any } = {}
      
      for (const prop of propertyRecords) {
        // Build a basic property structure from database fields
        // Note: This is a simplified reconstruction - full property schemas
        // (like Relation details, List configs, etc.) should come from schemaData
        const propertyData: any = {
          dataType: prop.dataType,
        }

        if (prop.schemaFileId) {
          propertyData.schemaFileId = prop.schemaFileId
        }

        // Add ref information if it's a relation
        if (prop.refModelId) {
          // Get the referenced model name
          const refModelRecords = await db
            .select({ name: modelsTable.name })
            .from(modelsTable)
            .where(eq(modelsTable.id, prop.refModelId))
            .limit(1)
          
          if (refModelRecords.length > 0) {
            propertyData.ref = refModelRecords[0].name
          }
        }

        if (prop.refValueType) {
          propertyData.refValueType = prop.refValueType
        }

        modelProperties[prop.name] = propertyData
      }

      // Create model structure
      models[modelName] = {
        properties: modelProperties,
        // Note: description would need to be stored separately
        // or reconstructed from schemaData if available
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
 * Returns model name by database model ID.
 */
export async function getModelNameByModelId(modelId: number): Promise<string | undefined> {
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  try {
    const rows = await db
      .select({ name: modelsTable.name })
      .from(modelsTable)
      .where(eq(modelsTable.id, modelId))
      .limit(1)
    return rows.length > 0 ? rows[0].name : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolves modelName and dataType for a property by its schemaFileId (e.g. context.id).
 * Used when machine context lacks these (e.g. just-created property renamed before full context is set).
 */
export async function getPropertyModelNameAndDataType(
  schemaFileId: string,
): Promise<{ modelName: string; dataType: string } | undefined> {
  const db = BaseDb.getAppDb()
  if (!db || !schemaFileId) return undefined
  try {
    const rows = await db
      .select({
        dataType: properties.dataType,
        modelId: properties.modelId,
      })
      .from(properties)
      .where(eq(properties.schemaFileId, schemaFileId))
      .limit(1)
    if (rows.length === 0) return undefined
    const modelRows = await db
      .select({ name: modelsTable.name })
      .from(modelsTable)
      .where(eq(modelsTable.id, rows[0].modelId))
      .limit(1)
    if (modelRows.length === 0) return undefined
    return {
      modelName: modelRows[0].name,
      dataType: rows[0].dataType ?? '',
    }
  } catch {
    return undefined
  }
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

  // Find the model: prefer modelId (reliable), then modelName as name, then modelName as schemaFileId
  // (context.modelName can be a model schemaFileId when schema uses that as identifier)
  let modelRecord: { id: number; name: string; schemaFileId: string | null } | undefined
  if (property.modelId != null && typeof property.modelId === 'number') {
    const byId = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.id, property.modelId))
      .limit(1)
    modelRecord = byId[0]
  }
  if (!modelRecord && property.modelName) {
    const byName = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.name, property.modelName))
      .limit(1)
    modelRecord = byName[0]
  }
  if (!modelRecord && property.modelName) {
    const bySchemaFileId = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, property.modelName))
      .limit(1)
    modelRecord = bySchemaFileId[0]
  }
  // Fallback: resolve model from existing property row (by schemaFileId) when modelName is wrong
  const schemaFileId = property._propertyFileId || (typeof property.id === 'string' ? property.id : undefined)
  if (!modelRecord && schemaFileId) {
    const propRows = await db
      .select({ modelId: properties.modelId })
      .from(properties)
      .where(eq(properties.schemaFileId, schemaFileId))
      .limit(1)
    if (propRows.length > 0 && propRows[0].modelId) {
      const byPropModelId = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.id, propRows[0].modelId))
        .limit(1)
      modelRecord = byPropModelId[0]
    }
  }
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
    dataType: property.dataType || '',
  }
  
  // Preserve schemaFileId if we have it
  if (schemaFileId) {
    propertyData.schemaFileId = schemaFileId
  }

  // Handle ref property - create ref model if needed
  if (property.refModelName) {
    const refModel = await createOrUpdate<NewModelRecord>(
      db,
      modelsTable,
      {
        name: property.refModelName,
      },
    )
    propertyData.refModelId = refModel.id
  } else if (property.refModelId) {
    propertyData.refModelId = property.refModelId
  } else {
    // If it's not a Relation type, ensure refModelId is null
    propertyData.refModelId = null
  }

  if (property.refValueType) {
    propertyData.refValueType = property.refValueType
  } else {
    // If refValueType is not set, ensure it's null
    propertyData.refValueType = null
  }

  propertyData.required = property.required ?? false

  if (existingProperties.length > 0) {
    // Property exists, update it with new values (including new name)
    // Set isEdited = true when property is edited
    const existingProperty = existingProperties[0]
    await db
      .update(properties)
      .set({
        ...propertyData,
        isEdited: true, // Mark as edited when saving changes
      })
      .where(eq(properties.id, existingProperty.id!))
    logger(`Updated property ${property.modelName}:${property._originalValues?.name || 'unknown'} -> ${property.name} in database`)
  } else {
    // Property doesn't exist, create it
    // Set isEdited = true for runtime-created properties
    await db.insert(properties).values({
      ...propertyData,
      isEdited: true, // Runtime-created properties are edited
    })
    logger(`Created property ${property.modelName}:${property.name} in database`)
  }
}

type NormalizedAddressConfig = { owned: string[]; watched: string[] }

function parseAddressConfig(value: string | null): NormalizedAddressConfig | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return { owned: parsed, watched: [] }
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.owned)) {
      return {
        owned: parsed.owned,
        watched: Array.isArray(parsed.watched) ? parsed.watched : [],
      }
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

export const getAddressesFromDb = async (): Promise<string[]> => {
  const config = await getAddressConfigFromDb()
  if (!config || config.owned.length === 0) {
    throw new Error('No addresses found')
  }
  return config.owned
}

/**
 * Like getAddressesFromDb but returns [] instead of throwing when no addresses are configured.
 * Returns owned addresses. Use getAllAddressesFromDb for sync (owned + watched).
 */
export const getAddressesFromDbOptional = async (): Promise<string[]> => {
  const config = await getAddressConfigFromDb()
  return config?.owned ?? []
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
  let modelRecords = await db
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
      try {
        const newModel = await db.insert(modelsTable).values({
          name: data.modelName,
          schemaFileId: modelFileId,
          isEdited: true, // Runtime-created models are edited
        }).returning()
        modelId = newModel[0].id!
      } catch (error: any) {
        // Handle unique constraint violation
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.message?.includes('UNIQUE constraint')) {
          logger(`Unique constraint violation for schemaFileId "${modelFileId}", attempting to find existing model`)
          const existing = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.schemaFileId, modelFileId))
            .limit(1)
          if (existing.length > 0) {
            modelId = existing[0].id!
            logger(`Found existing model with schemaFileId "${modelFileId}" (id: ${modelId}) after constraint violation`)
          } else {
            throw error
          }
        } else {
          throw error
        }
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
      
      await db.insert(modelSchemas).values({
        modelId,
        schemaId: data.schemaId,
      })
      // Notify React useModels so it can invalidate; live query over join often doesn't re-run when model_schemas is inserted.
      // Yield so the insert is visible to the refetch that will run when the broadcast is received.
      if (typeof BroadcastChannel !== 'undefined') {
        await new Promise((r) => setTimeout(r, 10))
        const row = schemaCheck[0]
        try {
          new BroadcastChannel('seed-models-invalidate').postMessage({
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
        const helpersIndexMod = await import('./index')
        const { generateId } = helpersIndexMod
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
 * @param isEdited - Optional flag indicating if property has been edited locally (default: false)
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
  isEdited: boolean = false
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
    dataType: data.dataType || '',
    schemaFileId: propertyFileId,
    isEdited: isEdited, // Persist isEdited flag
  }
  
  // Handle ref property - create ref model if needed
  // Check refModelName first, then ref (for backwards compatibility with schema files)
  const refModelName = data.refModelName || data.ref
  if (refModelName) {
    const refModel = await createOrUpdate<NewModelRecord>(
      db,
      modelsTable,
      {
        name: refModelName,
      },
    )
    propertyData.refModelId = refModel.id
  } else if (data.refModelId) {
    propertyData.refModelId = data.refModelId
  } else {
    // If it's not a Relation type, ensure refModelId is null
    propertyData.refModelId = null
  }
  
  if (data.refValueType) {
    propertyData.refValueType = data.refValueType
  } else {
    // If refValueType is not set, ensure it's null
    propertyData.refValueType = null
  }

  propertyData.required = data.required ?? false

  // Note: Additional property fields like storageType, localStorageDir, filenameSuffix
  // are not stored in the properties table but may be in the schema JSON
  
  if (existingProperties.length > 0) {
    // Property exists, update it with new values.
    // Use existing row id for WHERE (not name+modelId) so renames work: the row
    // may have the old name but we're updating to the new one.
    const existing = existingProperties[0]
    await db
      .update(properties)
      .set(propertyData)
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
        .set(propertyData)
        .where(eq(properties.id, doubleCheck[0].id!))
      logger(`Property with schemaFileId "${propertyFileId}" was created by another process, updated existing record`)
    } else {
      try {
        await db.insert(properties).values(propertyData)
        logger(`Created property ${data.name} (${propertyFileId}) in database`)
      } catch (error: any) {
        // Handle unique constraint violation
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.message?.includes('UNIQUE constraint')) {
          logger(`Unique constraint violation for property schemaFileId "${propertyFileId}", attempting to find existing property`)
          const existing = await db
            .select()
            .from(properties)
            .where(eq(properties.schemaFileId, propertyFileId))
            .limit(1)
          if (existing.length > 0) {
            await db
              .update(properties)
              .set(propertyData)
              .where(eq(properties.id, existing[0].id!))
            logger(`Found existing property with schemaFileId "${propertyFileId}" (id: ${existing[0].id}) after constraint violation, updated it`)
          } else {
            throw new Error(`Failed to create or find property "${data.name}" with schemaFileId "${propertyFileId}": ${error.message}`)
          }
        } else {
          throw error
        }
      }
    }
  }
}

/**
 * Get schema database ID from schema name or schemaFileId
 * @param schemaNameOrFileId - Schema name (string) or schemaFileId (string)
 * @returns Schema database ID
 * @throws Error if schema not found
 */
export async function getSchemaId(
  schemaNameOrFileId: string
): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not available')
  }

  const schemaSchemaMod = await import('../seedSchema/SchemaSchema')
  const { schemas: schemasTable } = schemaSchemaMod
  const drizzleMod = await import('drizzle-orm')
  const { eq, desc } = drizzleMod

  // Try to find by schemaFileId first (more reliable)
  let records = await db
    .select()
    .from(schemasTable)
    .where(eq(schemasTable.schemaFileId, schemaNameOrFileId))
    .orderBy(desc(schemasTable.version))
    .limit(1)

  // If not found by schemaFileId, try by name
  if (records.length === 0) {
    records = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, schemaNameOrFileId))
      .orderBy(desc(schemasTable.version))
      .limit(1)
  }

  if (records.length === 0) {
    throw new Error(`Schema "${schemaNameOrFileId}" not found in database`)
  }

  return records[0].id
}

/**
 * Get schema database ID from schemaFileId
 * @param schemaFileId - The schema file ID
 * @returns Schema database ID
 * @throws Error if schema not found
 */
export async function getSchemaIdByFileId(schemaFileId: string): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not available')
  }

  const schemaSchemaMod = await import('../seedSchema/SchemaSchema')
  const { schemas: schemasTable } = schemaSchemaMod
  const drizzleMod = await import('drizzle-orm')
  const { eq, desc } = drizzleMod

  const records = await db
    .select()
    .from(schemasTable)
    .where(eq(schemasTable.schemaFileId, schemaFileId))
    .orderBy(desc(schemasTable.version))
    .limit(1)

  if (records.length === 0) {
    throw new Error(`Schema with file ID "${schemaFileId}" not found in database`)
  }

  return records[0].id
}

/**
 * Get model database ID from model name or modelFileId
 * @param modelNameOrFileId - Model name (string) or modelFileId (string)
 * @param schemaNameOrId - Optional schema name or ID to narrow search
 * @returns Model database ID
 * @throws Error if model not found
 */
export async function getModelId(
  modelNameOrFileId: string,
  schemaNameOrId?: string | number
): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not available')
  }

  const modelSchemaMod = await import('../seedSchema/ModelSchema')
  const { models: modelsTable } = modelSchemaMod
  const drizzleMod = await import('drizzle-orm')
  const { eq, and, or } = drizzleMod

  // Try to find by modelFileId first (more reliable)
  let records = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.schemaFileId, modelNameOrFileId))
    .limit(1)

  // If not found by modelFileId, try by name
  if (records.length === 0) {
    const conditions = [eq(modelsTable.name, modelNameOrFileId)]
    
    // If schema is provided, narrow the search
    if (schemaNameOrId !== undefined) {
      const modelSchemaSchemaMod = await import('../seedSchema/ModelSchemaSchema')
      const { modelSchemas } = modelSchemaSchemaMod
      const schemaSchemaMod = await import('../seedSchema/SchemaSchema')
      const { schemas: schemasTable } = schemaSchemaMod
      
      if (typeof schemaNameOrId === 'number') {
        // schemaNameOrId is schemaId
        records = await db
          .select({ id: modelsTable.id })
          .from(modelsTable)
          .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
          .where(
            and(
              eq(modelsTable.name, modelNameOrFileId),
              eq(modelSchemas.schemaId, schemaNameOrId)
            )
          )
          .limit(1)
      } else {
        // schemaNameOrId is schemaName
        records = await db
          .select({ id: modelsTable.id })
          .from(modelsTable)
          .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
          .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
          .where(
            and(
              eq(modelsTable.name, modelNameOrFileId),
              eq(schemasTable.name, schemaNameOrId)
            )
          )
          .limit(1)
      }
    } else {
      // No schema filter, just search by name
      records = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.name, modelNameOrFileId))
        .limit(1)
    }
  }

  if (records.length === 0) {
    const schemaInfo = schemaNameOrId ? ` in schema "${schemaNameOrId}"` : ''
    throw new Error(`Model "${modelNameOrFileId}"${schemaInfo} not found in database`)
  }

  return records[0].id
}

/**
 * Get model database ID from modelFileId
 * @param modelFileId - The model file ID (schema_file_id)
 * @returns Model database ID
 * @throws Error if model not found
 */
export async function getModelIdByFileId(modelFileId: string): Promise<number> {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not available')
  }

  const modelSchemaMod = await import('../seedSchema/ModelSchema')
  const { models: modelsTable } = modelSchemaMod
  const drizzleMod = await import('drizzle-orm')
  const { eq } = drizzleMod

  const records = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.schemaFileId, modelFileId))
    .limit(1)

  if (records.length === 0) {
    throw new Error(`Model with file ID "${modelFileId}" not found in database`)
  }

  return records[0].id
}
