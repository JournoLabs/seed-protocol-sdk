import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { getLatestSchemaVersion, listCompleteSchemaFiles } from '@/helpers/schema'
import { SchemaFileFormat, type JsonImportSchema } from '@/types/import'
import { BaseFileManager, generateId, } from '@/helpers'
import { addModelsToDb, addSchemaToDb, loadModelsFromDbForSchema } from '@/helpers/db'
import { createModelsFromJson, getRefValueType } from '@/imports/json'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { eq, and, desc } from 'drizzle-orm'
import debug from 'debug'
import { isInternalSchema, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const logger = debug('seedSdk:schema:actors:loadOrCreateSchema')

/**
 * Query model IDs (schemaFileId) from database for a given schema
 * This is used to populate _liveQueryModelIds immediately when loading a schema
 * @param schemaId - The database ID of the schema
 * @returns Array of model file IDs (schemaFileId) for models linked to this schema
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
 * Create Model instances for all model IDs to ensure they're cached before getContext runs
 * This ensures that Model.getById() in Schema.getContext() will find the instances
 * @param modelIds - Array of model file IDs to create instances for
 */
const createModelInstances = async (modelIds: string[]): Promise<void> => {
  if (modelIds.length === 0) {
    return
  }

  try {
    const modelMod = await import('../../../Model/Model')
    const { Model } = modelMod

    // Create instances for all model IDs in parallel
    // Model.createById() will check cache first, then query DB and create if needed
    const createPromises = modelIds.map(async (modelFileId) => {
      try {
        const model = await Model.createById(modelFileId)
        if (model) {
          logger(`Created/cached Model instance for modelFileId "${modelFileId}"`)
        } else {
          logger(`Model.createById returned undefined for modelFileId "${modelFileId}" (may not exist in DB yet)`)
        }
      } catch (error) {
        logger(`Error creating Model instance for modelFileId "${modelFileId}": ${error}`)
        // Don't throw - continue with other models
      }
    })
    
    await Promise.all(createPromises)
    logger(`Finished creating/caching ${modelIds.length} Model instances`)
  } catch (error) {
    logger(`Error in createModelInstances: ${error}`)
    // Don't throw - this is best-effort to pre-populate cache
  }
}

/**
 * Verify that properties are persisted to the database for a given model
 * This is important in browser environments where database writes may not be immediately visible
 * @param modelId - Database ID of the model
 * @param modelName - Name of the model (for logging)
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelay - Delay between retries in milliseconds
 * @returns Promise that resolves when properties are found, or rejects if not found after max retries
 */
const verifyPropertiesPersisted = async (
  modelId: number,
  modelName: string,
  maxRetries: number = 10,
  retryDelay: number = 100
): Promise<void> => {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not available for property verification')
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const props = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.modelId, modelId))
      .limit(1)
    
    if (props.length > 0) {
      logger(`Verified properties exist for model "${modelName}" (modelId: ${modelId}) after ${attempt + 1} attempt(s)`)
      return
    }

    if (attempt < maxRetries - 1) {
      logger(`Properties not yet visible for model "${modelName}" (modelId: ${modelId}), retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }

  throw new Error(`Properties not found for model "${modelName}" (modelId: ${modelId}) after ${maxRetries} attempts. This may indicate a database write issue in the browser environment.`)
}

/**
 * Sanitize a schema name to be filesystem-safe
 * Replaces all special characters (except alphanumeric, hyphens, underscores) with underscores
 * Converts spaces to underscores
 * Removes leading/trailing underscores
 * 
 * @param name - Schema name to sanitize
 * @returns Sanitized name safe for use in filenames
 */
const sanitizeSchemaName = (name: string): string => {
  return name
    .replace(/[^a-zA-Z0-9\s_-]/g, '_') // Replace special chars (except spaces, hyphens, underscores) with underscore
    .replace(/\s+/g, '_') // Convert spaces to underscores
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .replace(/_+/g, '_') // Collapse multiple underscores to single
}

/**
 * Generate filename for a schema
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilename = (name: string, version: number, schemaFileId: string): string => {
  const sanitizedName = sanitizeSchemaName(name)
  return `${schemaFileId}_${sanitizedName}_v${version}.json`
}

/**
 * Get the full file path for a schema
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilePath = (name: string, version: number, schemaFileId: string): string => {
  const path = BaseFileManager.getPathModule()
  const filename = getSchemaFilename(name, version, schemaFileId)
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, filename)
}

export const loadOrCreateSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateSchema = async (): Promise<void> => {
    const { schemaName } = context
    
    // Check if this is an internal SDK schema (should not create files in app directory) — use static import so consumer bundles resolve correctly
    const isInternal = isInternalSchema(schemaName)
    
    if (isInternal && schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
      // For Seed Protocol, always load from internal file, never create new
      logger(`Loading internal Seed Protocol schema from SDK`)
      try {
        const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
        const schemaFile = internalSchema.default as SchemaFileFormat
        
        // Check if it exists in database, if not, add it
        const db = BaseDb.getAppDb()
        if (db && schemaFile.id) {
          const existing = await db
            .select()
            .from(schemas)
            .where(eq(schemas.schemaFileId, schemaFile.id))
            .limit(1)
          
          let schemaRecord = existing.length > 0 ? existing[0] : null
          
          if (existing.length === 0) {
            // Add to database if not present
            const schemaData = JSON.stringify(schemaFile, null, 2)
            schemaRecord = await addSchemaToDb(
              {
                name: schemaName,
                version: schemaFile.version,
                createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
                updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
              },
              schemaFile.id,
              schemaData,
              false, // isDraft = false (it's a published internal schema)
            )
            logger(`Added Seed Protocol schema to database`)
            
            // Also add models and properties to database
            // Convert to JsonImportSchema format for processing
            const importData: JsonImportSchema = {
              name: schemaName,
              models: Object.fromEntries(
                Object.entries(schemaFile.models || {}).map(([modelName, model]) => [
                  modelName,
                  {
                    ...model,
                    // Remove id field for import format
                    id: undefined,
                    properties: Object.fromEntries(
                      Object.entries(model.properties || {}).map(([propName, prop]) => {
                        const schemaProp = prop as any
                        const jsonProp: any = {
                          type: schemaProp.dataType || schemaProp.type,
                        }
                        
                        // Copy other properties
                        Object.keys(schemaProp).forEach(key => {
                          if (key !== 'id' && key !== 'dataType') {
                            jsonProp[key] = schemaProp[key]
                          }
                        })
                        
                        // Handle Relation type
                        if (schemaProp.ref || schemaProp.refModelName) {
                          jsonProp.model = schemaProp.refModelName || schemaProp.ref
                        }
                        
                        // Handle List type (case-insensitive refValueType)
                        const listRefValueType = getRefValueType(schemaProp as Record<string, unknown>)
                        if (schemaProp.dataType === 'List' && listRefValueType) {
                          jsonProp.refValueType = listRefValueType
                          if (schemaProp.ref || schemaProp.refModelName) {
                            jsonProp.ref = schemaProp.refModelName || schemaProp.ref
                          }
                        }
                        
                        // Handle storage configuration
                        if (schemaProp.storageType || schemaProp.localStorageDir || schemaProp.filenameSuffix) {
                          jsonProp.storage = {
                            type: schemaProp.storageType === 'ItemStorage' ? 'ItemStorage' : 'PropertyStorage',
                            path: schemaProp.localStorageDir,
                            extension: schemaProp.filenameSuffix,
                          }
                        }
                        
                        return [propName, jsonProp]
                      }),
                    ),
                  },
                ]),
              ) as JsonImportSchema['models'],
            }
            
            // Generate schema ID if missing
            if (!schemaFile.id) {
              schemaFile.id = generateId()
              logger('Generated schema ID for schema:', schemaFile.id)
            }

            // Extract schemaFileIds from JSON file and generate missing ones BEFORE creating models
            // This ensures Model instances are created with correct IDs
            const modelFileIds = new Map<string, string>()
            const propertyFileIds = new Map<string, Map<string, string>>()
            
            for (const [modelName, model] of Object.entries(schemaFile.models || {})) {
              // Generate model ID if missing
              if (!model.id) {
                model.id = generateId()
                logger(`Generated model ID for ${modelName}:`, model.id)
                // Update the schemaFile object so it's included in schemaData
                schemaFile.models[modelName].id = model.id
              }
              modelFileIds.set(modelName, model.id)
              
              const propIds = new Map<string, string>()
              for (const [propName, prop] of Object.entries(model.properties || {})) {
                // Generate property ID if missing
                if (!prop.id) {
                  prop.id = generateId()
                  logger(`Generated property ID for ${modelName}.${propName}:`, prop.id)
                  // Update the schemaFile object so it's included in schemaData
                  schemaFile.models[modelName].properties[propName].id = prop.id
                }
                propIds.set(propName, prop.id)
              }
              if (propIds.size > 0) {
                propertyFileIds.set(modelName, propIds)
              }
            }
            
            // Convert JSON models to Model classes, passing modelFileIds and propertyFileIds so Model instances use correct IDs
            const modelDefinitions = await createModelsFromJson(importData, modelFileIds, propertyFileIds)
            
            // Add models to database and link them to the schema with schemaFileIds
            if (Object.keys(modelDefinitions).length > 0 && schemaRecord) {
              await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
                schemaFileId: schemaFile.id,
                modelFileIds,
                propertyFileIds,
              })
              logger(`Added ${Object.keys(modelDefinitions).length} models and their properties to database for Seed Protocol schema`)
              
              // Verify properties are persisted (important for browser environments)
              // Query the database to get model IDs that were just created
              const modelLinks = await db
                .select({
                  modelId: modelSchemas.modelId,
                  modelName: modelsTable.name,
                })
                .from(modelSchemas)
                .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
                .where(eq(modelSchemas.schemaId, schemaRecord.id!))
              
              // Verify properties for at least one model (Seed model if available)
              const seedModelLink = modelLinks.find((link: { modelId: number | null; modelName: string | null }) => link.modelName === 'Seed')
              if (seedModelLink && seedModelLink.modelId) {
                await verifyPropertiesPersisted(seedModelLink.modelId, 'Seed', 10, 100)
              } else if (modelLinks.length > 0 && modelLinks[0].modelId) {
                // Fallback to first model if Seed not found
                await verifyPropertiesPersisted(modelLinks[0].modelId, modelLinks[0].modelName || 'unknown', 10, 100)
              }
            }
          } else {
            // Schema exists, but always ensure models/properties are in database
            // This handles the case where schema was added but models weren't (from previous code)
            // or where models were added but properties weren't
            // Check if models are linked to the schema
            const modelLinks = await db
              .select({
                modelId: modelSchemas.modelId,
                modelName: modelsTable.name,
              })
              .from(modelSchemas)
              .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
              .where(eq(modelSchemas.schemaId, schemaRecord.id!))
            
            // Check if we have all expected models
            const expectedModelNames = Object.keys(schemaFile.models || {})
            const linkedModelNames = modelLinks
              .map((link: { modelId: number | null; modelName: string | null }) => link.modelName)
              .filter((n: string | null): n is string => n !== null)
            const missingModels = expectedModelNames.filter(name => !linkedModelNames.includes(name))
            
            
            // Check if properties exist for linked models
            let missingProperties = false
            if (modelLinks.length > 0) {
              for (const link of modelLinks) {
                if (link.modelId) {
                  const props = await db
                    .select()
                    .from(propertiesTable)
                    .where(eq(propertiesTable.modelId, link.modelId))
                    .limit(1)
                  if (props.length === 0) {
                    missingProperties = true
                    break
                  }
                }
              }
            }
            
            // If models are missing or properties are missing, add them
            if (missingModels.length > 0 || missingProperties || modelLinks.length === 0) {
              logger(`Seed Protocol schema exists but models/properties incomplete (missing models: ${missingModels.length}, missing properties: ${missingProperties}), adding them now`)
              // Convert SchemaFileFormat to JsonImportSchema format
              // Schema format: { dataType, ref, refValueType, storageType, localStorageDir, filenameSuffix }
              // JSON import format: { type, model, items, storage: { type, path, extension } }
              const importData: JsonImportSchema = {
                name: schemaName,
                models: Object.fromEntries(
                  Object.entries(schemaFile.models || {}).map(([modelName, model]) => [
                    modelName,
                    {
                      ...model,
                      id: undefined,
                      properties: Object.fromEntries(
                        Object.entries(model.properties || {}).map(([propName, prop]) => {
                          const schemaProp = prop as any
                          const jsonProp: any = {
                            type: schemaProp.dataType || schemaProp.type,
                          }
                          
                          // Handle Relation type
                          if (schemaProp.ref || schemaProp.refModelName) {
                            jsonProp.model = schemaProp.refModelName || schemaProp.ref
                          }
                          
                          // Handle List type (support both refValueType and legacy items, case-insensitive)
                          if (schemaProp.dataType === 'List' || schemaProp.type === 'List') {
                            const refValueType = getRefValueType(schemaProp as Record<string, unknown>)
                            if (refValueType) {
                              jsonProp.refValueType = refValueType
                              const ref = schemaProp.ref ?? schemaProp.refModelName ?? schemaProp.items?.model
                              if (ref) jsonProp.ref = ref
                            }
                          }
                          
                          // Handle storage configuration
                          if (schemaProp.storageType || schemaProp.localStorageDir || schemaProp.filenameSuffix) {
                            jsonProp.storage = {
                              type: schemaProp.storageType === 'ItemStorage' ? 'ItemStorage' : 'PropertyStorage',
                              path: schemaProp.localStorageDir,
                              extension: schemaProp.filenameSuffix,
                            }
                          }
                          
                          return [propName, jsonProp]
                        }),
                      ),
                    },
                  ]),
                ) as JsonImportSchema['models'],
              }
              
              // Generate schema ID if missing
              if (!schemaFile.id) {
                schemaFile.id = generateId()
                logger('Generated schema ID for schema:', schemaFile.id)
              }

              // Extract schemaFileIds from JSON file and generate missing ones BEFORE creating models
              // This ensures Model instances are created with correct IDs
              const modelFileIds = new Map<string, string>()
              const propertyFileIds = new Map<string, Map<string, string>>()
              
              for (const [modelName, model] of Object.entries(schemaFile.models || {})) {
                // Generate model ID if missing
                if (!model.id) {
                  model.id = generateId()
                  logger(`Generated model ID for ${modelName}:`, model.id)
                  // Update the schemaFile object so it's included in schemaData
                  schemaFile.models[modelName].id = model.id
                }
                modelFileIds.set(modelName, model.id)
                
                const propIds = new Map<string, string>()
                for (const [propName, prop] of Object.entries(model.properties || {})) {
                  // Generate property ID if missing
                  if (!prop.id) {
                    prop.id = generateId()
                    logger(`Generated property ID for ${modelName}.${propName}:`, prop.id)
                    // Update the schemaFile object so it's included in schemaData
                    schemaFile.models[modelName].properties[propName].id = prop.id
                  }
                  propIds.set(propName, prop.id)
                }
                if (propIds.size > 0) {
                  propertyFileIds.set(modelName, propIds)
                }
              }
              
              // Convert JSON models to Model classes, passing modelFileIds and propertyFileIds so Model instances use correct IDs
              const modelDefinitions = await createModelsFromJson(importData, modelFileIds, propertyFileIds)
              
              
              // Verify all expected models are in modelDefinitions
              const missingFromDefinitions = expectedModelNames.filter(name => !Object.keys(modelDefinitions).includes(name))
              if (missingFromDefinitions.length > 0) {
                console.warn(`[loadOrCreateSchema] WARNING: Some expected models are missing from modelDefinitions: ${missingFromDefinitions.join(', ')}`)
              }
              
              if (Object.keys(modelDefinitions).length > 0) {
                await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
                  schemaFileId: schemaFile.id,
                  modelFileIds,
                  propertyFileIds,
                })
                logger(`Added ${Object.keys(modelDefinitions).length} models and their properties to database for existing Seed Protocol schema`)
                
                // Small delay to ensure database writes are visible (important for browser environments)
                await new Promise(resolve => setTimeout(resolve, 200))
                
                // Verify properties are persisted (important for browser environments)
                // Re-query model links to get updated model IDs
                // Retry querying until all expected models are visible
                const expectedModelNames = Object.keys(schemaFile.models || {})
                let updatedModelLinks: Array<{ modelId: number | null; modelName: string | null }> = []
                const maxRetries = 10
                const retryDelay = 100
                
                for (let attempt = 0; attempt < maxRetries; attempt++) {
                  updatedModelLinks = await db
                    .select({
                      modelId: modelSchemas.modelId,
                      modelName: modelsTable.name,
                    })
                    .from(modelSchemas)
                    .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
                    .where(eq(modelSchemas.schemaId, schemaRecord.id!))
                  
                  const linkedModelNames = updatedModelLinks
                    .map((link: { modelId: number | null; modelName: string | null }) => link.modelName)
                    .filter((n: string | null): n is string => n !== null)
                  
                  const allModelsPresent = expectedModelNames.every(name => linkedModelNames.includes(name))
                  
                  if (allModelsPresent) {
                    break
                  }
                  
                  if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay))
                  }
                }
                
                
                // Verify properties for at least one model (Seed model if available)
                const seedModelLink = updatedModelLinks.find((link: { modelId: number | null; modelName: string | null }) => link.modelName === 'Seed')
                if (seedModelLink && seedModelLink.modelId) {
                  await verifyPropertiesPersisted(seedModelLink.modelId, 'Seed', 10, 100)
                } else if (updatedModelLinks.length > 0 && updatedModelLinks[0].modelId) {
                  // Fallback to first model if Seed not found
                  await verifyPropertiesPersisted(updatedModelLinks[0].modelId, updatedModelLinks[0].modelName || 'unknown', 10, 100)
                }
              }
            } else {
              logger(`Seed Protocol schema exists with all models and properties already in database`)
            }
          }
          
          // Query model IDs from database to populate _liveQueryModelIds immediately
          let modelIds: string[] = []
          if (schemaRecord && schemaRecord.id) {
            modelIds = await getModelIdsForSchema(schemaRecord.id)
            // Create Model instances so they're cached before getContext runs
            await createModelInstances(modelIds)
          }
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            _liveQueryModelIds: modelIds,
          })
          return
        } else {
          // No database available, send schema without model IDs
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            _liveQueryModelIds: [],
          })
          return
        }
      } catch (error) {
        logger(`Error loading internal Seed Protocol schema: ${error}`)
        // Fall through to normal loading logic
      }
    }

    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not found')
    }

    // STEP 1: Query database first for existing schema (prefer drafts)
    // First try by name (most common case)
    let dbSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, schemaName))
      .orderBy(desc(schemas.isDraft), desc(schemas.version))
      .limit(1)

    // If not found by name, also try querying by schemaFileId directly
    // This handles the case where an ID is passed instead of a name (e.g., 'test-schema-1')
    if (dbSchemas.length === 0) {
      logger(`No schema found by name "${schemaName}", trying to find by schemaFileId`)
      const schemasByFileId = await db
        .select()
        .from(schemas)
        .where(eq(schemas.schemaFileId, schemaName))
        .orderBy(desc(schemas.isDraft), desc(schemas.version))
        .limit(1)
      
      if (schemasByFileId.length > 0) {
        logger(`Found schema by schemaFileId "${schemaName}" (name in DB: ${schemasByFileId[0].name})`)
        dbSchemas = schemasByFileId
      }
    }

    // If not found by name, or if found but it's not a draft, try to find by schemaFileId from file
    // This handles the case where a draft's name was changed but we're loading by the old name
    const shouldTrySchemaFileId = dbSchemas.length === 0 || (dbSchemas.length > 0 && dbSchemas[0].isDraft === false)
    
    if (shouldTrySchemaFileId) {
      // First, try to get schemaFileId from file if it exists
      const completeSchemas = await listCompleteSchemaFiles()
      const matchingFileSchemas = completeSchemas.filter((s) => s.name === schemaName)
      
      if (matchingFileSchemas.length > 0) {
        const latestFile = matchingFileSchemas.reduce((prev, current) =>
          current.version > prev.version ? current : prev,
        )
        
        // Read file to get schemaFileId
        try {
          const content = await BaseFileManager.readFileAsString(latestFile.filePath)
          const fileSchema = JSON.parse(content) as SchemaFileFormat
          
          if (fileSchema.id) {
            // Look up by schemaFileId - query for DRAFTS first, then published
            // This ensures we find the draft even if there's also a published version
            const draftsByFileId = await db
              .select()
              .from(schemas)
              .where(and(
                eq(schemas.schemaFileId, fileSchema.id),
                eq(schemas.isDraft, true)
              ))
              .orderBy(desc(schemas.version))
              .limit(1)
            
            if (draftsByFileId.length > 0) {
              logger(`Found DRAFT by schemaFileId ${fileSchema.id} (name in DB: ${draftsByFileId[0].name}, requested name: ${schemaName})`)
              dbSchemas = draftsByFileId
            } else {
              // No draft found, check for any record with this schemaFileId
              const dbSchemasByFileId = await db
                .select()
                .from(schemas)
                .where(eq(schemas.schemaFileId, fileSchema.id))
                .orderBy(desc(schemas.isDraft), desc(schemas.version))
                .limit(1)
              
              if (dbSchemasByFileId.length > 0) {
                const foundSchema = dbSchemasByFileId[0]
                logger(`Found schema by schemaFileId ${fileSchema.id} (name in DB: ${foundSchema.name}, requested name: ${schemaName}, isDraft: ${foundSchema.isDraft})`)
                
                // Always prefer the one found by schemaFileId if we didn't find anything by name
                // OR if the one found by schemaFileId is a draft (even if we found a non-draft by name)
                if (foundSchema.isDraft === true || dbSchemas.length === 0) {
                  dbSchemas = dbSchemasByFileId
                  logger(`Using schema found by schemaFileId (isDraft: ${foundSchema.isDraft})`)
                } else if (foundSchema.isDraft === false && dbSchemas.length > 0 && dbSchemas[0].isDraft === false) {
                  // Both are non-drafts, prefer the one found by schemaFileId (more reliable)
                  dbSchemas = dbSchemasByFileId
                  logger(`Both schemas are non-drafts, using the one found by schemaFileId`)
                } else {
                  logger(`Keeping schema found by name (isDraft: ${dbSchemas[0].isDraft}) over schemaFileId result (isDraft: ${foundSchema.isDraft})`)
                }
              }
            }
          }
        } catch (error) {
          logger(`Error reading file to get schemaFileId: ${error}`)
        }
      }
      
      // If still not found and no file exists, try querying all drafts to see if any have metadata.name matching
      // This handles the case where a draft was renamed but there's no file (draft-only schema)
      if (dbSchemas.length === 0) {
        logger(`No schema found by name "${schemaName}" and no matching file, checking all drafts for potential match`)
        const allDrafts = await db
          .select()
          .from(schemas)
          .where(eq(schemas.isDraft, true))
          .orderBy(desc(schemas.version))
        
        logger(`Checking ${allDrafts.length} drafts for normalized name match`)
        
        // Check each draft's schemaData to see if metadata.name matches
        // Use case-insensitive and normalized comparison to handle name changes like "blog-schema" -> "Blog Schema"
        const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const normalizedRequested = normalizeName(schemaName)
        logger(`Normalized requested name: "${schemaName}" -> "${normalizedRequested}"`)
        
        for (const draft of allDrafts) {
          if (draft.schemaData) {
            try {
              const draftSchema = JSON.parse(draft.schemaData) as SchemaFileFormat
              const draftMetadataName = draftSchema.metadata?.name || ''
              const draftDbName = draft.name || ''
              
              // Check if normalized names match (handles "blog-schema" vs "Blog Schema")
              const normalizedDraftMetadata = normalizeName(draftMetadataName)
              const normalizedDraftDb = normalizeName(draftDbName)
              
              logger(`Checking draft: DB name="${draftDbName}" (normalized: "${normalizedDraftDb}"), metadata.name="${draftMetadataName}" (normalized: "${normalizedDraftMetadata}")`)
              
              if (normalizedDraftMetadata === normalizedRequested || normalizedDraftDb === normalizedRequested) {
                dbSchemas = [draft]
                logger(`Found draft by normalized name match: DB name="${draftDbName}", metadata.name="${draftMetadataName}", requested="${schemaName}" (normalized: "${normalizedRequested}")`)
                break
              }
            } catch (error) {
              logger(`Error parsing draft schemaData: ${error}`)
              // Skip drafts with invalid schemaData
              continue
            }
          } else {
            logger(`Draft ${draft.name} (id: ${draft.id}) has no schemaData, skipping`)
          }
        }
        
        if (dbSchemas.length === 0) {
          logger(`No draft found matching normalized name "${normalizedRequested}"`)
        }
      }
    }

    if (dbSchemas.length > 0) {
      const dbSchema = dbSchemas[0]
      
      logger(`Found schema record: name="${dbSchema.name}", isDraft=${dbSchema.isDraft}, hasSchemaData=${!!dbSchema.schemaData}, schemaFileId="${dbSchema.schemaFileId}"`)

      // If it's a draft, load from schemaData
      if (dbSchema.isDraft === true && dbSchema.schemaData) {
        try {
          const schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
          logger(`Found draft schema ${schemaName} v${schemaFile.version} in database (DB name: ${dbSchema.name}, metadata.name: ${schemaFile.metadata?.name})`)
          
          // CRITICAL: Ensure schema.id matches schemaFileId from database (database is source of truth)
          if (dbSchema.schemaFileId && schemaFile.id !== dbSchema.schemaFileId) {
            logger(`Fixing schema ID mismatch: schema.id="${schemaFile.id}" does not match schemaFileId="${dbSchema.schemaFileId}" from database. Using database value as source of truth.`)
            schemaFile.id = dbSchema.schemaFileId
          } else if (!schemaFile.id && dbSchema.schemaFileId) {
            logger(`Schema missing id, using schemaFileId from database: "${dbSchema.schemaFileId}"`)
            schemaFile.id = dbSchema.schemaFileId
          }
          
          // Verify metadata matches what we expect
          if (schemaFile.metadata?.name !== dbSchema.name) {
            logger(`WARNING: Metadata name mismatch! DB name="${dbSchema.name}", metadata.name="${schemaFile.metadata?.name}"`)
          }
          
          // Build merged models without mutating schemaFile (read-only approach)
          let mergedModels = { ...(schemaFile.models || {}) }
          
          // Ensure models are populated (fallback for seed-protocol if missing)
          if ((!mergedModels || Object.keys(mergedModels).length === 0) && schemaName === 'Seed Protocol') {
            try {
              const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
              const internalSchemaFile = internalSchema.default as SchemaFileFormat
              mergedModels = { ...(internalSchemaFile.models || {}) }
              logger(`Populated models for seed-protocol schema from internal file`)
            } catch (error) {
              logger(`Error loading internal seed-protocol schema for models:`, error)
            }
          }
          
          // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
          // This ensures models added to the database are included even if they're not in schemaData
          if (dbSchema.id) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              logger(`Found ${Object.keys(dbModels).length} models in database for schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
              // Merge: database models take precedence for properties, but preserve schemaData models for full structure
              mergedModels = {
                ...mergedModels,
                ...dbModels,
              }
              // For models that exist in both, merge properties (database properties override)
              // When a property was renamed in DB, schemaData has old name and DB has new name (same schemaFileId).
              // Remove schemaData properties whose id matches a DB property's schemaFileId to avoid duplicates.
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  const schemaDataProps = mergedModels[modelName].properties || {}
                  const dbProps = dbModel.properties || {}

                  const dbSchemaFileIds = new Set<string>()
                  for (const dbProp of Object.values(dbProps)) {
                    if ((dbProp as any).schemaFileId) {
                      dbSchemaFileIds.add((dbProp as any).schemaFileId)
                    }
                  }

                  const filteredSchemaDataProps: Record<string, any> = {}
                  for (const [propName, prop] of Object.entries(schemaDataProps)) {
                    const propId = (prop as any).id || (prop as any).schemaFileId
                    if (propId && dbSchemaFileIds.has(propId)) {
                      continue
                    }
                    filteredSchemaDataProps[propName] = prop
                  }

                  mergedModels[modelName] = {
                    ...mergedModels[modelName],
                    properties: {
                      ...filteredSchemaDataProps,
                      ...dbProps,
                    },
                  }
                }
              }
            }
          }
          
          // Create new schemaFile object with merged models (read-only approach)
          const finalSchemaFile: SchemaFileFormat = {
            ...schemaFile,
            models: mergedModels,
          }
          
          // Query model IDs from database to populate _liveQueryModelIds immediately
          let modelIds: string[] = []
          if (dbSchema.id) {
            modelIds = await getModelIdsForSchema(dbSchema.id)
            // Create Model instances so they're cached before getContext runs
            await createModelInstances(modelIds)
          }
          
          // Track conflict detection metadata
          const loadedAt = Date.now()
          const dbVersion = dbSchema.version
          const dbUpdatedAt = dbSchema.updatedAt || loadedAt
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: finalSchemaFile,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
            _liveQueryModelIds: modelIds,
          } as any)
          return
        } catch (error) {
          logger(`Error parsing schemaData for ${schemaName}:`, error)
          // Fall through to file-based loading
        }
      }

      // If it's not a draft and has schemaFileId, try to load from file
      // BUT: First check if there's a draft with the same schemaFileId (in case name changed)
      if (dbSchema.isDraft === false && dbSchema.schemaFileId) {
        logger(`Schema is not a draft (isDraft=${dbSchema.isDraft}), checking if there's a draft with same schemaFileId before loading from file`)
        
        // Check for a draft with the same schemaFileId (handles name changes)
        const draftsByFileId = await db
          .select()
          .from(schemas)
          .where(and(
            eq(schemas.schemaFileId, dbSchema.schemaFileId),
            eq(schemas.isDraft, true)
          ))
          .orderBy(desc(schemas.version))
          .limit(1)
        
        if (draftsByFileId.length > 0 && draftsByFileId[0].schemaData) {
          logger(`Found draft with same schemaFileId (name: "${draftsByFileId[0].name}"), using it instead of published version`)
          try {
            const schemaFile = JSON.parse(draftsByFileId[0].schemaData) as SchemaFileFormat
            logger(`Found draft schema ${schemaName} v${schemaFile.version} in database (DB name: ${draftsByFileId[0].name}, metadata.name: ${schemaFile.metadata?.name})`)
            
            // CRITICAL: Ensure schema.id matches schemaFileId from database (database is source of truth)
            if (draftsByFileId[0].schemaFileId && schemaFile.id !== draftsByFileId[0].schemaFileId) {
              logger(`Fixing schema ID mismatch: schema.id="${schemaFile.id}" does not match schemaFileId="${draftsByFileId[0].schemaFileId}" from database. Using database value as source of truth.`)
              schemaFile.id = draftsByFileId[0].schemaFileId
            } else if (!schemaFile.id && draftsByFileId[0].schemaFileId) {
              logger(`Schema missing id, using schemaFileId from database: "${draftsByFileId[0].schemaFileId}"`)
              schemaFile.id = draftsByFileId[0].schemaFileId
            }
            
            // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
            // This ensures models added to the database are included even if they're not in schemaData
            if (draftsByFileId[0].id) {
              const dbModels = await loadModelsFromDbForSchema(draftsByFileId[0].id)
              if (Object.keys(dbModels).length > 0) {
                logger(`Found ${Object.keys(dbModels).length} models in database for draft schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
                // Merge: database models take precedence for properties, but preserve schemaData models for full structure
                let mergedModels = { ...(schemaFile.models || {}) }
                mergedModels = {
                  ...mergedModels,
                  ...dbModels,
                }
                // For models that exist in both, merge properties (database properties override)
                // When a property was renamed in DB, schemaData has old name and DB has new name (same schemaFileId).
                // Remove schemaData properties whose id matches a DB property's schemaFileId to avoid duplicates.
                for (const [modelName, dbModel] of Object.entries(dbModels)) {
                  if (mergedModels[modelName]) {
                    const schemaDataProps = mergedModels[modelName].properties || {}
                    const dbProps = dbModel.properties || {}

                    const dbSchemaFileIds = new Set<string>()
                    for (const dbProp of Object.values(dbProps)) {
                      if ((dbProp as any).schemaFileId) {
                        dbSchemaFileIds.add((dbProp as any).schemaFileId)
                      }
                    }

                    const filteredSchemaDataProps: Record<string, any> = {}
                    for (const [propName, prop] of Object.entries(schemaDataProps)) {
                      const propId = (prop as any).id || (prop as any).schemaFileId
                      if (propId && dbSchemaFileIds.has(propId)) {
                        continue
                      }
                      filteredSchemaDataProps[propName] = prop
                    }

                    mergedModels[modelName] = {
                      ...mergedModels[modelName],
                      properties: {
                        ...filteredSchemaDataProps,
                        ...dbProps,
                      },
                    }
                  }
                }
                // Update schemaFile with merged models
                schemaFile.models = mergedModels
              }
            }
            
            // Query model IDs from database to populate _liveQueryModelIds immediately
            let modelIds: string[] = []
            if (draftsByFileId[0].id) {
              modelIds = await getModelIdsForSchema(draftsByFileId[0].id)
              // Create Model instances so they're cached before getContext runs
              await createModelInstances(modelIds)
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = draftsByFileId[0].version || schemaFile.version
            const dbUpdatedAt = draftsByFileId[0].updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
              _liveQueryModelIds: modelIds,
            } as any)
            return
          } catch (error) {
            logger(`Error parsing draft schemaData: ${error}, falling back to file`)
          }
        }
        
        logger(`No draft found with same schemaFileId, will try to load from file instead of schemaData`)
        
        // Try ID-based file lookup first (preferred)
        let schemaFile: SchemaFileFormat | null = null
        if (dbSchema.schemaFileId) {
          try {
            // Try to find file by schemaFileId in the complete schemas list
            const completeSchemas = await listCompleteSchemaFiles()
            const idBasedMatch = completeSchemas.find((s) => s.schemaFileId === dbSchema.schemaFileId)
            
            if (idBasedMatch) {
              logger(`Found schema file by schemaFileId: ${idBasedMatch.filePath}`)
              const content = await BaseFileManager.readFileAsString(idBasedMatch.filePath)
              schemaFile = JSON.parse(content) as SchemaFileFormat
            } else {
              // Try direct file path lookup by ID
              const idBasedPath = getSchemaFilePath(dbSchema.name, dbSchema.version, dbSchema.schemaFileId)
              try {
                const content = await BaseFileManager.readFileAsString(idBasedPath)
                schemaFile = JSON.parse(content) as SchemaFileFormat
                logger(`Found schema file by direct ID-based path: ${idBasedPath}`)
              } catch {
                // ID-based file doesn't exist, fall through to name-based
              }
            }
          } catch (error) {
            logger(`Error loading ID-based file: ${error}, falling back to name-based`)
          }
        }
        
        // Fall back to name-based file lookup (backward compatibility)
        if (!schemaFile) {
          const completeSchemas = await listCompleteSchemaFiles()
          const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)
          
          if (matchingSchemas.length > 0) {
            // Find the schema with the highest version
            const latest = matchingSchemas.reduce((prev, current) =>
              current.version > prev.version ? current : prev,
            )

            // Read the file directly to get SchemaFileFormat
            const content = await BaseFileManager.readFileAsString(latest.filePath)
            schemaFile = JSON.parse(content) as SchemaFileFormat
          }
        }
        
        if (schemaFile) {

          // Build merged models without mutating schemaFile (read-only approach)
          let mergedModels = { ...(schemaFile.models || {}) }
          
          // Ensure models are populated (fallback for seed-protocol if missing)
          if ((!mergedModels || Object.keys(mergedModels).length === 0) && schemaName === 'Seed Protocol') {
            try {
              const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
              const internalSchemaFile = internalSchema.default as SchemaFileFormat
              mergedModels = { ...(internalSchemaFile.models || {}) }
              logger(`Populated models for seed-protocol schema from internal file`)
            } catch (error) {
              logger(`Error loading internal seed-protocol schema for models:`, error)
            }
          }

          // CRITICAL: Merge models from database (model_schemas join table) with models from file
          // This ensures models added to the database are included even if they're not in the file
          if (dbSchema.id) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              logger(`Found ${Object.keys(dbModels).length} models in database for schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
              // Merge: database models take precedence for properties, but preserve file models for full structure
              mergedModels = {
                ...mergedModels,
                ...dbModels,
              }
              // For models that exist in both, merge properties (database properties override)
              // When a property was renamed in DB, schemaData has old name and DB has new name (same schemaFileId).
              // Remove schemaData properties whose id matches a DB property's schemaFileId to avoid duplicates.
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  const schemaDataProps = mergedModels[modelName].properties || {}
                  const dbProps = dbModel.properties || {}

                  const dbSchemaFileIds = new Set<string>()
                  for (const dbProp of Object.values(dbProps)) {
                    if ((dbProp as any).schemaFileId) {
                      dbSchemaFileIds.add((dbProp as any).schemaFileId)
                    }
                  }

                  const filteredSchemaDataProps: Record<string, any> = {}
                  for (const [propName, prop] of Object.entries(schemaDataProps)) {
                    const propId = (prop as any).id || (prop as any).schemaFileId
                    if (propId && dbSchemaFileIds.has(propId)) {
                      continue
                    }
                    filteredSchemaDataProps[propName] = prop
                  }

                  mergedModels[modelName] = {
                    ...mergedModels[modelName],
                    properties: {
                      ...filteredSchemaDataProps,
                      ...dbProps,
                    },
                  }
                }
              }
            }
          }
          
          // Create new schemaFile object with merged models (read-only approach)
          const finalSchemaFile: SchemaFileFormat = {
            ...schemaFile,
            models: mergedModels,
          }

          logger(`Found existing schema ${schemaName} v${schemaFile.version} from file`)
          // Debug: Log what we're sending
          logger(`Sending schema with ${Object.keys(schemaFile.models || {}).length} models: ${Object.keys(schemaFile.models || {}).join(', ')}`)
          
          // Query model IDs from database to populate _liveQueryModelIds immediately
          let modelIds: string[] = []
          if (dbSchema.id) {
            modelIds = await getModelIdsForSchema(dbSchema.id)
            // Create Model instances so they're cached before getContext runs
            await createModelInstances(modelIds)
          }
          
          // Track conflict detection metadata from DB record
          const loadedAt = Date.now()
          const dbVersion = dbSchema.version || schemaFile.version
          const dbUpdatedAt = dbSchema.updatedAt || loadedAt
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
            _liveQueryModelIds: modelIds,
          } as any)
          return
        }
        
        // File doesn't exist, but we have schemaData in database - use it as fallback
        if (dbSchema.schemaData) {
          try {
            const schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
            logger(`Found published schema ${schemaName} v${schemaFile.version} in database (file not found, using schemaData)`)
            
            // Build merged models without mutating schemaFile (read-only approach)
            let mergedModels = { ...(schemaFile.models || {}) }
            
            // Ensure models are populated (fallback for seed-protocol if missing)
            if ((!mergedModels || Object.keys(mergedModels).length === 0) && schemaName === 'Seed Protocol') {
              try {
                const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
                const internalSchemaFile = internalSchema.default as SchemaFileFormat
                mergedModels = { ...(internalSchemaFile.models || {}) }
                logger(`Populated models for seed-protocol schema from internal file`)
              } catch (error) {
                logger(`Error loading internal seed-protocol schema for models:`, error)
              }
            }
            
            // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
            // This ensures models added to the database are included even if they're not in schemaData
            if (dbSchema.id) {
              const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
              if (Object.keys(dbModels).length > 0) {
                logger(`Found ${Object.keys(dbModels).length} models in database for schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
                // Merge: database models take precedence for properties, but preserve schemaData models for full structure
                mergedModels = {
                  ...mergedModels,
                  ...dbModels,
                }
                // For models that exist in both, merge properties (database properties override)
                // When a property was renamed in DB, schemaData has old name and DB has new name (same schemaFileId).
                // Remove schemaData properties whose id matches a DB property's schemaFileId to avoid duplicates.
                for (const [modelName, dbModel] of Object.entries(dbModels)) {
                  if (mergedModels[modelName]) {
                    const schemaDataProps = mergedModels[modelName].properties || {}
                    const dbProps = dbModel.properties || {}

                    const dbSchemaFileIds = new Set<string>()
                    for (const dbProp of Object.values(dbProps)) {
                      if ((dbProp as any).schemaFileId) {
                        dbSchemaFileIds.add((dbProp as any).schemaFileId)
                      }
                    }

                    const filteredSchemaDataProps: Record<string, any> = {}
                    for (const [propName, prop] of Object.entries(schemaDataProps)) {
                      const propId = (prop as any).id || (prop as any).schemaFileId
                      if (propId && dbSchemaFileIds.has(propId)) {
                        continue
                      }
                      filteredSchemaDataProps[propName] = prop
                    }

                    mergedModels[modelName] = {
                      ...mergedModels[modelName],
                      properties: {
                        ...filteredSchemaDataProps,
                        ...dbProps,
                      },
                    }
                  }
                }
              }
            }
            
            // Create new schemaFile object with merged models (read-only approach)
            const finalSchemaFile: SchemaFileFormat = {
              ...schemaFile,
              models: mergedModels,
            }
            
            // Query model IDs from database to populate _liveQueryModelIds immediately
            let modelIds: string[] = []
            if (dbSchema.id) {
              modelIds = await getModelIdsForSchema(dbSchema.id)
              // Create Model instances so they're cached before getContext runs
              await createModelInstances(modelIds)
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = dbSchema.version || schemaFile.version
            const dbUpdatedAt = dbSchema.updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
              _liveQueryModelIds: modelIds,
            } as any)
            return
          } catch (error) {
            logger(`Error parsing schemaData for published schema ${schemaName}:`, error)
            // Fall through to try internal schema or file-based loading
          }
        }
        
        // If schemaData is missing, try to load from internal schema file for seed-protocol
        if (!dbSchema.schemaData && schemaName === 'Seed Protocol') {
          try {
            const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
            const schemaFile = internalSchema.default as SchemaFileFormat
            logger(`Found seed-protocol schema in internal file (schemaData missing, using internal schema)`)
            
            // Update database with schemaData for future loads
            const schemaData = JSON.stringify(schemaFile, null, 2)
            await addSchemaToDb(
              {
                name: schemaName,
                version: dbSchema.version,
                createdAt: dbSchema.createdAt || new Date().getTime(),
                updatedAt: new Date().getTime(),
              },
              dbSchema.schemaFileId || schemaFile.id,
              schemaData,
              false, // isDraft = false
            )
            
            // Query model IDs from database to populate _liveQueryModelIds immediately
            let modelIds: string[] = []
            if (dbSchema.id) {
              modelIds = await getModelIdsForSchema(dbSchema.id)
              // Create Model instances so they're cached before getContext runs
              await createModelInstances(modelIds)
            }
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              _liveQueryModelIds: modelIds,
            })
            return
          } catch (error) {
            logger(`Error loading internal seed-protocol schema:`, error)
            // Fall through to file-based loading
          }
        }
      }
    }

    // STEP 2: Check for existing schema files (for backward compatibility)
    // BUT: Only load from file if we didn't find a draft in the database
    // This prevents loading old file data when a draft with a renamed schema exists
    const completeSchemas = await listCompleteSchemaFiles()
    const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)

    if (matchingSchemas.length > 0) {
      // Before loading from file, check if there's a draft in the database that might match
      // (This handles the case where the schema was renamed but the file still has the old name)
      const allDrafts = await db
        .select()
        .from(schemas)
        .where(eq(schemas.isDraft, true))
        .orderBy(desc(schemas.version))
      
      const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const normalizedRequested = normalizeName(schemaName)
      
      // Check if any draft matches by normalized name
      let matchingDraft = null
      for (const draft of allDrafts) {
        if (draft.schemaData) {
          try {
            const draftSchema = JSON.parse(draft.schemaData) as SchemaFileFormat
            const draftMetadataName = draftSchema.metadata?.name || ''
            const draftDbName = draft.name || ''
            
            const normalizedDraftMetadata = normalizeName(draftMetadataName)
            const normalizedDraftDb = normalizeName(draftDbName)
            
            if (normalizedDraftMetadata === normalizedRequested || normalizedDraftDb === normalizedRequested) {
              matchingDraft = draft
              logger(`Found matching draft in database (DB name: "${draftDbName}", metadata.name: "${draftMetadataName}") - preferring it over file with old name "${schemaName}"`)
              break
            }
          } catch (error) {
            continue
          }
        }
      }
      
      // If we found a matching draft, use it instead of the file
      if (matchingDraft && matchingDraft.schemaData) {
        try {
          const schemaFile = JSON.parse(matchingDraft.schemaData) as SchemaFileFormat
          logger(`Loading draft from database instead of file (draft has name "${matchingDraft.name}", file has "${schemaName}")`)
          
          // Query model IDs from database to populate _liveQueryModelIds immediately
          let modelIds: string[] = []
          if (matchingDraft.id) {
            modelIds = await getModelIdsForSchema(matchingDraft.id)
            // Create Model instances so they're cached before getContext runs
            await createModelInstances(modelIds)
          }
          
          // Track conflict detection metadata
          const loadedAt = Date.now()
          const dbVersion = matchingDraft.version || schemaFile.version
          const dbUpdatedAt = matchingDraft.updatedAt || loadedAt
          
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
              _liveQueryModelIds: modelIds,
            } as any)
            return
        } catch (error) {
          logger(`Error parsing draft schemaData, falling back to file: ${error}`)
        }
      }
      
      // No matching draft found, proceed with loading from file
      // Find the schema with the highest version
      const latest = matchingSchemas.reduce((prev, current) =>
        current.version > prev.version ? current : prev,
      )

      // Read the file directly to get SchemaFileFormat
      const content = await BaseFileManager.readFileAsString(latest.filePath)
      const schemaFile = JSON.parse(content) as SchemaFileFormat

      // Build merged models without mutating schemaFile (read-only approach)
      let mergedModels = { ...(schemaFile.models || {}) }
      
      // Ensure models are populated (fallback for seed-protocol if missing)
      if ((!mergedModels || Object.keys(mergedModels).length === 0) && schemaName === 'Seed Protocol') {
        try {
          const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
          const internalSchemaFile = internalSchema.default as SchemaFileFormat
          mergedModels = { ...(internalSchemaFile.models || {}) }
          logger(`Populated models for seed-protocol schema from internal file`)
        } catch (error) {
          logger(`Error loading internal seed-protocol schema for models:`, error)
        }
      }

      logger(`Found existing schema ${schemaName} v${schemaFile.version} from file`)
      
          // Query model IDs from database if schema exists in DB
          let modelIds: string[] = []
          try {
            const db = BaseDb.getAppDb()
            if (db && schemaFile.id) {
              const schemaRecords = await db
                .select()
                .from(schemas)
                .where(eq(schemas.schemaFileId, schemaFile.id))
                .limit(1)
              
              if (schemaRecords.length > 0 && schemaRecords[0].id) {
                modelIds = await getModelIdsForSchema(schemaRecords[0].id)
                // Create Model instances so they're cached before getContext runs
                await createModelInstances(modelIds)
              }
            }
          } catch (error) {
            logger(`Error querying model IDs for schema from file: ${error}`)
          }
          
          // Track conflict detection metadata (no DB record, use file metadata)
          const loadedAt = Date.now()
          const dbVersion = schemaFile.version
          const dbUpdatedAt = new Date(schemaFile.metadata.updatedAt).getTime() || loadedAt
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
            _liveQueryModelIds: modelIds,
          } as any)
          return
    }

    // STEP 3: Before creating new schema, check database one more time for any existing record
    // This handles the case where a schema exists in DB but wasn't found by name (e.g., name mismatch)
    // or where the file lookup failed but the DB has the correct schemaFileId
    let existingDbSchema: typeof schemas.$inferSelect | undefined
    try {
      const dbCheck = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, schemaName))
        .orderBy(desc(schemas.version))
        .limit(1)
      
      if (dbCheck.length > 0) {
        const foundSchema = dbCheck[0]
        existingDbSchema = foundSchema
        logger(`Found existing DB record for "${schemaName}" before creating new schema (schemaFileId: ${foundSchema.schemaFileId}, isDraft: ${foundSchema.isDraft})`)
        
        // If we have a schemaFileId, check if file exists with that ID
        if (foundSchema.schemaFileId) {
          const filePath = getSchemaFilePath(schemaName, foundSchema.version, foundSchema.schemaFileId)
          const fileExists = await BaseFileManager.pathExists(filePath)
          
          if (fileExists) {
            logger(`File exists for schemaFileId ${foundSchema.schemaFileId}, loading it instead of creating new schema`)
            const content = await BaseFileManager.readFileAsString(filePath)
            const schemaFile = JSON.parse(content) as SchemaFileFormat
            
            // Ensure schema.id matches schemaFileId from database
            if (schemaFile.id !== foundSchema.schemaFileId) {
              logger(`Fixing schema ID mismatch: file has id="${schemaFile.id}", DB has schemaFileId="${foundSchema.schemaFileId}". Using DB value.`)
              schemaFile.id = foundSchema.schemaFileId
            }
            
            // Query model IDs from database to populate _liveQueryModelIds immediately
            let modelIds: string[] = []
            if (foundSchema.id) {
              modelIds = await getModelIdsForSchema(foundSchema.id)
              // Create Model instances so they're cached before getContext runs
              await createModelInstances(modelIds)
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = foundSchema.version || schemaFile.version
            const dbUpdatedAt = foundSchema.updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
              _liveQueryModelIds: modelIds,
            } as any)
            return
          }
        }
        
        // If it's a draft, load it from schemaData
        if (foundSchema.isDraft === true && foundSchema.schemaData) {
          try {
            const schemaFile = JSON.parse(foundSchema.schemaData) as SchemaFileFormat
            
            // Ensure schema.id matches schemaFileId from database
            if (foundSchema.schemaFileId && schemaFile.id !== foundSchema.schemaFileId) {
              logger(`Fixing schema ID mismatch: schemaData has id="${schemaFile.id}", DB has schemaFileId="${foundSchema.schemaFileId}". Using DB value.`)
              schemaFile.id = foundSchema.schemaFileId
            }
            
            logger(`Loading existing draft from database instead of creating new schema`)
            
            // Query model IDs from database to populate _liveQueryModelIds immediately
            let modelIds: string[] = []
            if (foundSchema.id) {
              modelIds = await getModelIdsForSchema(foundSchema.id)
              // Create Model instances so they're cached before getContext runs
              await createModelInstances(modelIds)
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = foundSchema.version || schemaFile.version
            const dbUpdatedAt = foundSchema.updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
              _liveQueryModelIds: modelIds,
            } as any)
            return
          } catch (error) {
            logger(`Error parsing existing draft schemaData: ${error}, will create new schema`)
          }
        }
      }
    } catch (error) {
      logger(`Error checking database before creating new schema: ${error}, proceeding with creation`)
    }

    // STEP 4: Create new schema as draft in database (NOT in file yet)
    const latestVersion = existingDbSchema?.version ? existingDbSchema.version + 1 : await getLatestSchemaVersion(schemaName)
    const newVersion = latestVersion + 1

    const now = new Date().toISOString()
    const newSchema: SchemaFileFormat = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: newVersion,
      id: generateId(), // Generate schema ID when first written
      metadata: {
        name: schemaName,
        createdAt: now,
        updatedAt: now,
      },
      models: {},
      enums: {},
      migrations: [
        {
          version: newVersion,
          timestamp: now,
          description: 'Initial schema',
          changes: [],
        },
      ],
    }

    // Save to database as draft FIRST (before creating any file)
    const schemaData = JSON.stringify(newSchema, null, 2)
    await addSchemaToDb(
      {
        name: schemaName,
        version: newVersion,
        createdAt: new Date(now).getTime(),
        updatedAt: new Date(now).getTime(),
      },
      newSchema.id, // schemaFileId
      schemaData, // Full schema content
      true, // isDraft = true
    )

    logger(`Created new draft schema ${schemaName} v${newVersion} in database`)
    
    // Query model IDs from database for newly created schema
    let modelIds: string[] = []
    try {
      const db = BaseDb.getAppDb()
      if (db && newSchema.id) {
        const schemaRecords = await db
          .select()
          .from(schemas)
          .where(eq(schemas.schemaFileId, newSchema.id))
          .limit(1)
        
        if (schemaRecords.length > 0 && schemaRecords[0].id) {
          modelIds = await getModelIdsForSchema(schemaRecords[0].id)
          // Create Model instances so they're cached before getContext runs
          await createModelInstances(modelIds)
        }
      }
    } catch (error) {
      logger(`Error querying model IDs for new schema: ${error}`)
    }
    
    // Track conflict detection metadata for new schema
    const loadedAt = Date.now()
    const dbVersion = newVersion
    const dbUpdatedAt = new Date(now).getTime()
    
    sendBack({
      type: 'loadOrCreateSchemaSuccess',
      schema: newSchema,
      loadedAt,
      dbVersion,
      dbUpdatedAt,
      _liveQueryModelIds: modelIds,
    } as any)
  }

  _loadOrCreateSchema().catch((error) => {
    logger('Error loading or creating schema:', error)
    sendBack({ type: 'loadOrCreateSchemaError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})
