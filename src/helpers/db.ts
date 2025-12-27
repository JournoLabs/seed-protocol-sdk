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
      if (schemaData !== undefined) {
        updates.schemaData = schemaData
      }
      if (isDraft !== undefined) {
        updates.isDraft = isDraft
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
    if (schemaData !== undefined) {
      updates.schemaData = schemaData
    }
    if (isDraft !== undefined) {
      updates.isDraft = isDraft
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
