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
import { ModelProperty } from '@/ModelProperty/ModelProperty'
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

  row.columnNames.forEach((colName, index) => {
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
    obj = queryResult.rows.reduce((acc, row) => {
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
 * @returns The schema record (either existing or newly created)
 */
export const addSchemaToDb = async (
  schema: Omit<SchemaType, 'id' | 'schemaFileId' | 'schemaData' | 'isDraft'>,
  schemaFileId?: string,
  schemaData?: string,
  isDraft?: boolean,
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
  const existingSchemas = await db
    .select()
    .from(schemas)
    .where(eq(schemas.name, schema.name))
    .limit(1)

  if (existingSchemas.length > 0) {
    // Update fields if provided
    const updates: Partial<typeof schemas.$inferInsert> = {}
    if (schemaFileId && !existingSchemas[0].schemaFileId) {
      updates.schemaFileId = schemaFileId
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
    if (isDraft !== undefined && existingSchemas[0].isDraft !== isDraft) {
      updates.isDraft = isDraft
    }
    if (schema.updatedAt && existingSchemas[0].updatedAt !== schema.updatedAt) {
      updates.updatedAt = schema.updatedAt
    }
    if (Object.keys(updates).length > 0) {
      await db
        .update(schemas)
        .set(updates)
        .where(eq(schemas.id, existingSchemas[0].id!))
      return { ...existingSchemas[0], ...updates }
    }
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
    createdAt: schema.createdAt,
    updatedAt: schema.updatedAt,
  } as NewSchemaRecord).returning()
  
  return newSchema[0]
}

/**
 * Rename a model in the database
 * Updates the model name and all properties that reference it
 * @param oldName - The current model name
 * @param newName - The new model name
 * @returns The updated model record
 */
export const renameModelInDb = async (
  oldName: string,
  newName: string,
): Promise<NewModelRecord> => {
  const db = BaseDb.getAppDb()

  if (!db) {
    throw new Error('Database not found')
  }

  // Find the model by old name
  const existingModels = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.name, oldName))
    .limit(1)

  if (existingModels.length === 0) {
    // Model doesn't exist, create it with new name
    const newModel = await db.insert(modelsTable).values({ name: newName }).returning()
    return newModel[0] as NewModelRecord
  }

  const modelToRename = existingModels[0]

  // Check if a model with the new name already exists
  const existingWithNewName = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.name, newName))
    .limit(1)

  if (existingWithNewName.length > 0) {
    // New name already exists, return it
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
  schemaFileValue?: { dataType?: string; ref?: string; refValueType?: string },
): Promise<boolean> {
  try {
    const cacheKey = `${modelName}:${propertyName}`
    
    // First, check the in-memory cache (for current session edits)
    const ModelPropertyClass = ModelProperty as typeof ModelProperty & {
      instanceCache: Map<string, { instance: ModelProperty; refCount: number }>
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
  let schemaRecord: typeof schemas.$inferSelect | undefined
  if (schema) {
    schemaRecord = await addSchemaToDb(schema, schemaFileData?.schemaFileId)
  }

  // Handle model renames first if provided
  if (modelRenames) {
    for (const [oldName, newName] of modelRenames.entries()) {
      await renameModelInDb(oldName, newName)
    }
  }

  // Search for all models by schemaFileId (preferred) or name and create them if they don't exist
  const modelRecords = new Map<string, NewModelRecord>()
  
  for (const [modelName, modelClass] of Object.entries(models)) {
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
    
    // Fallback to finding by name, or create new
    if (!modelRecord) {
      modelRecord = await createOrUpdate<NewModelRecord>(db, modelsTable, {
        name: modelName,
      })
    }
    
    // Update schemaFileId if we have it and it's not set
    if (modelFileId && !modelRecord.schemaFileId) {
      await db
        .update(modelsTable)
        .set({ schemaFileId: modelFileId })
        .where(eq(modelsTable.id, modelRecord.id!))
      modelRecord = { ...modelRecord, schemaFileId: modelFileId }
    }
    
    modelRecords.set(modelName, modelRecord)

    // Get all existing properties for this model upfront to handle renamed properties
    const allDbProperties = await db
      .select()
      .from(properties)
      .where(eq(properties.modelId, modelRecord.id!))
    
    // Track which DB properties have been matched to schema properties
    const matchedDbPropertyIds = new Set<number>()
    
    // Get schema property names to check for orphaned DB properties
    const schemaPropertyNames = new Set(Object.keys(modelClass.schema || {}))

    // Search for all properties and create them if they don't exist
    // Properties are unique by name + modelId, so we search using both
    const schemaEntries = Object.entries(modelClass.schema || {})
    for (let index = 0; index < schemaEntries.length; index++) {
      const [propertyName, propertyValues] = schemaEntries[index]
      
      if (!propertyValues) {
        throw new Error(`Property values not found for ${propertyName}`)
      }
      
      // Get property schemaFileId if available
      const propertyFileId = schemaFileData?.propertyFileIds?.get(modelName)?.get(propertyName)
      
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
      }

      // Handle ref property - create ref model if needed
      let expectedRefModelId: number | null = null
      if (propertyValues.ref) {
        const refModel = await createOrUpdate<NewModelRecord>(
          db,
          modelsTable,
          {
            name: propertyValues.ref,
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
        await db
          .update(properties)
          .set(propertyData)
          .where(eq(properties.id, existingProperty.id!))
      } else {
        // Property doesn't exist, create it with schemaFileId
        await db.insert(properties).values(propertyData)
      }
    }
  }

  // If schema was provided, create modelSchema join records to connect models to the schema
  if (schemaRecord) {
    // Check for existing records first since there's no unique constraint
    for (const [modelName, modelRecord] of modelRecords.entries()) {
      const existingJoinRecords = await db
        .select()
        .from(modelSchemas)
        .where(
          and(
            eq(modelSchemas.modelId, modelRecord.id!),
            eq(modelSchemas.schemaId, schemaRecord.id!),
          ),
        )
        .limit(1)

      if (existingJoinRecords.length === 0) {
        type NewModelSchemaRecord = InferInsertModel<typeof modelSchemas>
        await db.insert(modelSchemas).values({
          modelId: modelRecord.id!,
          schemaId: schemaRecord.id!,
        } as NewModelSchemaRecord)
      }
    }
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
        // Note: description and indexes would need to be stored separately
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

  if (!property.modelName || !property.name) {
    throw new Error('Model name and property name are required')
  }

  // Find the model
  const modelRecords = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.name, property.modelName))
    .limit(1)

  if (modelRecords.length === 0) {
    throw new Error(`Model ${property.modelName} not found in database`)
  }

  const modelRecord = modelRecords[0]

  // Find existing property
  const existingProperties = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.name, property.name),
        eq(properties.modelId, modelRecord.id!),
      ),
    )
    .limit(1)

  // Prepare property data
  const propertyData: Partial<NewPropertyRecord> = {
    name: property.name,
    modelId: modelRecord.id!,
    dataType: property.dataType || '',
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

  if (existingProperties.length > 0) {
    // Property exists, update it with new values
    await db
      .update(properties)
      .set(propertyData)
      .where(
        and(
          eq(properties.name, property.name),
          eq(properties.modelId, modelRecord.id!),
        ),
      )
    logger(`Updated property ${property.modelName}:${property.name} in database`)
  } else {
    // Property doesn't exist, create it
    await db.insert(properties).values(propertyData)
    logger(`Created property ${property.modelName}:${property.name} in database`)
  }
}

export const getAddressesFromDb = async (): Promise<string[]> => {
  const appDb = BaseDb.getAppDb()

  if (!appDb) {
    return new Promise((resolve) => {
      setTimeout(async () => {
        const addresses = await getAddressesFromDb()
        resolve(addresses)
      }, 500)
    })
  }

  const appStatesRecords = await appDb
    .select()
    .from(appState)
    .where(eq(appState.key, 'addresses'))
    .limit(1)

  if (!appStatesRecords || appStatesRecords.length === 0) {
    throw new Error('No appStatesRecords for addresses found')
  }

  const addressRecord = appStatesRecords[0]

  const addressArrayString = addressRecord.value

  if (!addressArrayString) {
    throw new Error('No addresses found')
  }

  return JSON.parse(addressArrayString)
}

/**
 * Write model to database and create model_schemas join entry
 * @param modelFileId - The model file ID (schema_file_id)
 * @param data - Model data including modelName, schemaId, and optional properties, indexes, description
 */
export async function writeModelToDb(
  modelFileId: string,
  data: {
    modelName: string
    schemaId: number
    properties?: { [name: string]: any }
    indexes?: string[]
    description?: string
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
    const newModel = await db.insert(modelsTable).values({
      name: data.modelName,
      schemaFileId: modelFileId,
    }).returning()
    modelId = newModel[0].id!
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
  
  // Create model_schemas join entry
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
    type NewModelSchemaRecord = InferInsertModel<typeof modelSchemas>
    await db.insert(modelSchemas).values({
      modelId,
      schemaId: data.schemaId,
    } as NewModelSchemaRecord)
  }
  
  // Write properties if provided
  if (data.properties) {
    for (const [propName, propData] of Object.entries(data.properties)) {
      // Generate propertyFileId if not provided in propData
      const propertyFileId = propData.id || `${modelFileId}:${propName}`
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
    storageType?: string
    localStorageDir?: string
    filenameSuffix?: string
    [key: string]: any
  }
): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  
  // Find existing property by modelId and name
  const existingProperties = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.name, data.name),
        eq(properties.modelId, data.modelId),
      ),
    )
    .limit(1)
  
  // Prepare property data
  const propertyData: Partial<NewPropertyRecord> = {
    name: data.name,
    modelId: data.modelId,
    dataType: data.dataType || '',
    schemaFileId: propertyFileId,
  }
  
  // Handle ref property - create ref model if needed
  if (data.refModelName) {
    const refModel = await createOrUpdate<NewModelRecord>(
      db,
      modelsTable,
      {
        name: data.refModelName,
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
  
  // Note: Additional property fields like storageType, localStorageDir, filenameSuffix
  // are not stored in the properties table but may be in the schema JSON
  
  if (existingProperties.length > 0) {
    // Property exists, update it with new values
    await db
      .update(properties)
      .set(propertyData)
      .where(
        and(
          eq(properties.name, data.name),
          eq(properties.modelId, data.modelId),
        ),
      )
    logger(`Updated property ${data.name} (${propertyFileId}) in database`)
  } else {
    // Property doesn't exist, create it
    await db.insert(properties).values(propertyData)
    logger(`Created property ${data.name} (${propertyFileId}) in database`)
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

  const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
  const { eq, desc } = await import('drizzle-orm')

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

  const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
  const { eq, desc } = await import('drizzle-orm')

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

  const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
  const { eq, and, or } = await import('drizzle-orm')

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
      const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
      const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
      
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

  const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
  const { eq } = await import('drizzle-orm')

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
