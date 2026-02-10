import { BaseFileManager } from '../helpers/FileManager/BaseFileManager'
import { JsonImportSchema, SchemaFileFormat } from '../types/import'
import { ModelPropertyDataTypes } from '@/Schema'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/helpers/property'
import { ModelDefinitions, ModelClassType } from '@/types'
// Dynamic import to break circular dependency with helpers/db -> ModelProperty -> updateSchema -> imports/json
// import { addModelsToDb, addSchemaToDb } from '@/helpers/db'
import { generateId } from '@/helpers'
import debug from 'debug'
// Dynamic import to break circular dependency: ClientManager -> processSchemaFiles -> imports/json -> ClientManager
// import { getClient } from '@/client/ClientManager'
import { ClientManagerEvents } from '@/client/constants'
import { BaseDb } from '@/db/Db/BaseDb'

const logger = debug('seedSdk:imports:json')

/**
 * Verify that properties are persisted to the database for a given model
 * This is important in browser environments where database writes may not be immediately visible
 * @param db - Database instance
 * @param modelId - Database ID of the model
 * @param modelName - Name of the model (for logging)
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelay - Delay between retries in milliseconds
 * @returns Promise that resolves when properties are found, or rejects if not found after max retries
 */
const verifyPropertiesPersisted = async (
  db: any,
  modelId: number,
  modelName: string,
  maxRetries: number = 10,
  retryDelay: number = 100
): Promise<void> => {
  const { properties: propertiesTable } = await import('../seedSchema/ModelSchema')
  const { eq } = await import('drizzle-orm')

  console.log(`[verifyPropertiesPersisted] Starting verification for model "${modelName}" (modelId: ${modelId})`)

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const props = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.modelId, modelId))
      .limit(1)
    
    console.log(`[verifyPropertiesPersisted] Attempt ${attempt + 1}/${maxRetries}: found ${props.length} properties for model "${modelName}" (modelId: ${modelId})`)
    
    if (props.length > 0) {
      console.log(`[verifyPropertiesPersisted] ✓ Verified properties exist for model "${modelName}" (modelId: ${modelId}) after ${attempt + 1} attempt(s)`)
      logger(`Verified properties exist for model "${modelName}" (modelId: ${modelId}) after ${attempt + 1} attempt(s)`)
      return
    }

    if (attempt < maxRetries - 1) {
      console.log(`[verifyPropertiesPersisted] Properties not yet visible for model "${modelName}" (modelId: ${modelId}), retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`)
      logger(`Properties not yet visible for model "${modelName}" (modelId: ${modelId}), retrying in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }

  console.log(`[verifyPropertiesPersisted] ✗ Properties not found for model "${modelName}" (modelId: ${modelId}) after ${maxRetries} attempts`)
  throw new Error(`Properties not found for model "${modelName}" (modelId: ${modelId}) after ${maxRetries} attempts. This may indicate a database write issue in the browser environment.`)
}

/**
 * Compare two schema files structurally, ignoring metadata timestamps
 * This is used to determine if an existing schema file matches the schema being imported
 * @param schema1 - First schema to compare
 * @param schema2 - Second schema to compare
 * @returns true if schemas are structurally equivalent, false otherwise
 */
function compareSchemasStructurally(
  schema1: SchemaFileFormat,
  schema2: SchemaFileFormat,
): boolean {
  // Compare basic fields
  if (schema1.$schema !== schema2.$schema) return false
  if (schema1.version !== schema2.version) return false
  if (schema1.id !== schema2.id) return false
  
  // Compare metadata (ignoring timestamps)
  if (schema1.metadata?.name !== schema2.metadata?.name) return false
  
  // Compare models structure
  const models1 = schema1.models || {}
  const models2 = schema2.models || {}
  
  const modelNames1 = Object.keys(models1).sort()
  const modelNames2 = Object.keys(models2).sort()
  
  if (modelNames1.length !== modelNames2.length) return false
  if (!modelNames1.every((name, i) => name === modelNames2[i])) return false
  
  // Compare each model's structure
  for (const modelName of modelNames1) {
    const model1 = models1[modelName]
    const model2 = models2[modelName]
    
    // Compare model IDs if both have them
    if (model1.id !== model2.id) return false
    
    // Compare properties
    const props1 = model1.properties || {}
    const props2 = model2.properties || {}
    
    const propNames1 = Object.keys(props1).sort()
    const propNames2 = Object.keys(props2).sort()
    
    if (propNames1.length !== propNames2.length) return false
    if (!propNames1.every((name, i) => name === propNames2[i])) return false
    
    // Compare each property's structure
    for (const propName of propNames1) {
      const prop1 = props1[propName]
      const prop2 = props2[propName]
      
      // Compare property IDs if both have them
      if (prop1.id !== prop2.id) return false
      
      // Compare property types
      if (prop1.type !== prop2.type) return false
      
      // Compare other relevant fields (ref, items, etc.)
      if (prop1.ref !== prop2.ref) return false
      if (prop1.items?.type !== prop2.items?.type) return false
      if (prop1.items?.model !== prop2.items?.model) return false
    }
  }
  
  // Compare enums
  const enums1 = schema1.enums || {}
  const enums2 = schema2.enums || {}
  
  const enumNames1 = Object.keys(enums1).sort()
  const enumNames2 = Object.keys(enums2).sort()
  
  if (enumNames1.length !== enumNames2.length) return false
  if (!enumNames1.every((name, i) => name === enumNames2[i])) return false
  
  // Note: We don't compare migrations as they're historical records
  // and may differ even for the same schema structure
  
  return true
}

/**
 * Transform import JSON format to full schema file format
 * @param importData - The JSON import data
 * @param version - The version number for the schema (defaults to 1)
 * @returns The transformed schema file format
 */
export const transformImportToSchemaFile = (
  importData: JsonImportSchema,
  version: number = 1,
): SchemaFileFormat => {
  const now = new Date().toISOString()
  const schemaId = generateId()

  // Generate IDs for models and properties
  const modelsWithIds: SchemaFileFormat['models'] = {}
  for (const [modelName, modelDef] of Object.entries(importData.models)) {
    const modelId = generateId()
    const propertiesWithIds: { [propertyName: string]: any } = {}
    
    for (const [propertyName, propertyDef] of Object.entries(modelDef.properties)) {
      const propertyId = generateId()
      propertiesWithIds[propertyName] = {
        ...propertyDef,
        id: propertyId,
      }
    }
    
    modelsWithIds[modelName] = {
      ...modelDef,
      id: modelId,
      properties: propertiesWithIds,
    }
  }

  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version,
    id: schemaId,
    metadata: {
      name: importData.name,
      createdAt: now,
      updatedAt: now,
    },
    models: modelsWithIds,
    enums: {},
    migrations: [
      {
        version,
        timestamp: now,
        description: 'Initial schema',
        changes: [],
      },
    ],
  }
}

/**
 * Parse JSON import content (string) into JsonImportSchema format
 * Supports two formats:
 * 1. Minimal format: { name: string, models: {...} }
 * 2. Complete schema format: { $schema: string, metadata: { name: string }, models: {...}, ... }
 * @param content - The JSON content as a string
 * @returns The parsed JSON import data normalized to JsonImportSchema format
 * @throws Error if content cannot be parsed
 */
export const parseJsonImportContent = (
  content: string,
): JsonImportSchema => {
  try {
    const data = JSON.parse(content) as any

    // Determine the format and extract name
    let schemaName: string | undefined
    
    // Check if it's a complete schema format (has $schema field)
    if (data.$schema) {
      // Complete schema format: name is in metadata.name
      schemaName = data.metadata?.name
    } else {
      // Minimal format: name is at top level
      schemaName = data.name
    }

    if (!schemaName) {
      throw new Error('Schema name is required (either at top level or in metadata.name)')
    }

    // Return normalized JsonImportSchema format
    return {
      name: schemaName,
      models: data.models,
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON content: ${error.message}`)
    }
    throw new Error(
      `Failed to parse JSON import content: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Read and parse a JSON import file
 * Supports two formats:
 * 1. Minimal format: { name: string, models: {...} }
 * 2. Complete schema format: { $schema: string, metadata: { name: string }, models: {...}, ... }
 * @param filePath - Path to the JSON import file
 * @returns The parsed JSON import data normalized to JsonImportSchema format
 * @throws Error if file cannot be read or parsed
 */
export const readJsonImportFile = async (
  filePath: string,
): Promise<JsonImportSchema> => {
  try {
    const workingDir = BaseFileManager.getWorkingDir()
    let internalFilePath = filePath
    if (!filePath.startsWith(workingDir)) {
      internalFilePath = `${workingDir}/${filePath}`
    }
    const content = await BaseFileManager.readFileAsString(internalFilePath)
    return parseJsonImportContent(content)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in file ${filePath}: ${error.message}`)
    }
    throw new Error(
      `Failed to read JSON import file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
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
 * Get the full file path for a schema file
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param workingDir - Working directory path
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilePath = (workingDir: string, name: string, version: number, schemaFileId: string): string => {
  const path = BaseFileManager.getPathModule()
  const sanitizedName = sanitizeSchemaName(name)
  const filename = `${schemaFileId}_${sanitizedName}_v${version}.json`
  return path.join(workingDir, filename)
}

/**
 * Import a JSON schema file and save it in the full schema file format
 * Also converts the JSON models to Model classes and adds them to the database
 * @param importFilePath - Path to the JSON import file
 * @param version - The version number for the schema (defaults to 1)
 * @returns The file path where the schema was saved
 * @throws Error if import file cannot be read, parsed, or if schema already exists
 */
export async function importJsonSchema(
  importFilePath: string,
  version?: number,
): Promise<string>
/**
 * Import a JSON schema from file contents and save it in the full schema file format
 * Also converts the JSON models to Model classes and adds them to the database
 * @param importFileContents - Object containing the JSON file contents as a string
 * @param version - The version number for the schema (defaults to 1)
 * @returns The file path where the schema was saved
 * @throws Error if import content cannot be parsed, or if schema already exists
 */
export async function importJsonSchema(
  importFileContents: { contents: string },
  version?: number,
): Promise<string>
export async function importJsonSchema(
  importFilePathOrContents: string | { contents: string },
  version: number = 1,
): Promise<string> {
  // Determine if we have a file path or file contents
  let importData: JsonImportSchema | undefined
  let importFilePath: string | undefined
  let originalSchemaFile: SchemaFileFormat | undefined

  if (typeof importFilePathOrContents === 'string') {
    // It's a file path
    importFilePath = importFilePathOrContents
    importData = await readJsonImportFile(importFilePath)
  } else {
    // It's file contents - check if it's already a complete schema format
    try {
      const parsed = JSON.parse(importFilePathOrContents.contents) as any
      if (parsed.$schema && parsed.id && parsed.metadata) {
        // It's already a complete schema format - preserve it
        originalSchemaFile = parsed as SchemaFileFormat
        logger(`Input is already a complete schema format, preserving original ID: ${originalSchemaFile.id}`)
      }
    } catch {
      // Not valid JSON or not a complete schema, parse as import format
    }
    
    if (!originalSchemaFile) {
      importData = parseJsonImportContent(importFilePathOrContents.contents)
    }
  }

  // Use original schema file if available, otherwise transform from import format
  let schemaFile: SchemaFileFormat
  if (originalSchemaFile) {
    schemaFile = originalSchemaFile
    // Use provided version if different, otherwise use version from schema
    if (version !== undefined && version !== schemaFile.version) {
      schemaFile = { ...schemaFile, version }
    }
    
    // Generate missing IDs for complete schema files
    if (!schemaFile.id) {
      schemaFile.id = generateId()
      logger('Generated schema ID for imported complete schema:', schemaFile.id)
    }
    
    // Before generating IDs, check if a file already exists with this schemaFileId
    // This handles the case where the schema was already loaded via loadSchemaFromFile
    const workingDir = BaseFileManager.getWorkingDir()
    const path = BaseFileManager.getPathModule()
    const existingFilePath = getSchemaFilePath(workingDir, schemaFile.metadata.name, schemaFile.version, schemaFile.id)
    const existingFileExists = await BaseFileManager.pathExists(existingFilePath)
    
    if (existingFileExists) {
      // File already exists with this schemaFileId - just load it instead of creating a new one
      logger(`Schema file already exists with schemaFileId ${schemaFile.id}, loading it instead of creating new file`)
      return await loadSchemaFromFile(existingFilePath)
    }
    
    // Generate missing model and property IDs
    for (const [modelName, model] of Object.entries(schemaFile.models || {})) {
      if (!model.id) {
        model.id = generateId()
        logger(`Generated model ID for ${modelName}:`, model.id)
      }
      
      for (const [propName, prop] of Object.entries(model.properties || {})) {
        if (!prop.id) {
          prop.id = generateId()
          logger(`Generated property ID for ${modelName}.${propName}:`, prop.id)
        }
      }
    }
  } else {
    if (!importData) {
      throw new Error('Failed to parse import data: neither complete schema nor import format could be determined')
    }
    schemaFile = transformImportToSchemaFile(importData, version)
  }

  // Check if this is an internal SDK schema (should not create files in app directory)
  const { isInternalSchema } = await import('../helpers/constants')
  const isInternal = isInternalSchema(schemaFile.metadata.name, schemaFile.id)
  
  if (isInternal) {
    logger(`Skipping file creation for internal schema: ${schemaFile.metadata.name}`)
    // For internal schemas, just load to database and store, don't create file
    // Extract schema name and version
    const schemaName = schemaFile.metadata?.name
    const version = schemaFile.version

    if (!schemaName) {
      throw new Error('Schema name is required in metadata.name')
    }

    // Convert to JsonImportSchema format for processing
    const importDataForInternal: JsonImportSchema = {
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
                  // Remove id field for import format
                  id: undefined,
                }
                
                // Handle Relation type - convert ref to model
                if (schemaProp.ref || schemaProp.refModelName) {
                  jsonProp.model = schemaProp.refModelName || schemaProp.ref
                }
                
                // Handle List type
                if ((schemaProp.dataType === 'List' || schemaProp.type === 'List') && schemaProp.refValueType) {
                  jsonProp.items = {
                    type: schemaProp.refValueType,
                    model: schemaProp.refModelName || schemaProp.ref,
                  }
                }
                
                // Copy other properties (storage, etc.)
                Object.keys(schemaProp).forEach(key => {
                  if (key !== 'id' && key !== 'dataType' && key !== 'type' && key !== 'ref' && key !== 'refModelName' && key !== 'refValueType') {
                    jsonProp[key] = schemaProp[key]
                  }
                })
                
                return [propName, jsonProp]
              }),
            ),
          },
        ]),
      ) as unknown as JsonImportSchema['models'],
    }

    // Generate schema ID if missing
    if (!schemaFile.id) {
      schemaFile.id = generateId()
      logger('Generated schema ID for internal schema:', schemaFile.id)
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
    const modelDefinitions = await createModelsFromJson(importDataForInternal, modelFileIds, propertyFileIds)

    logger('loadSchemaFromFile (internal) - modelDefinitions length:', Object.keys(modelDefinitions).length)

    // Convert schema file metadata to schema input for database
    const schemaInput = {
      name: schemaName,
      version,
      schemaFileId: schemaFile.id || null,
      createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
      updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
    } as Parameters<typeof addSchemaToDb>[0]

    // Use dynamic import to break circular dependency
    const { addSchemaToDb, addModelsToDb } = await import('../helpers/db')
    
    // Try to add schema and models to database if database is available
    try {
      const db = BaseDb.getAppDb()
      if (db) {
        // Store full schema data in database as fallback when file is not available
        // schemaFile already has all IDs (from JSON file or generated), so we can use it directly
        const schemaData = JSON.stringify(schemaFile, null, 2)
        
        // Add schema to database (creates or returns existing) with schemaFileId and schemaData
        const schemaRecord = await addSchemaToDb(schemaInput, schemaFile.id, schemaData, false)

        // Add models to database and link them to the schema with schemaFileIds (only if there are models)
        if (Object.keys(modelDefinitions).length > 0) {
          console.log(`[importJsonSchema] Adding ${Object.keys(modelDefinitions).length} models to database for internal schema "${schemaName}": ${Object.keys(modelDefinitions).join(', ')}`)
          await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
            schemaFileId: schemaFile.id,
            modelFileIds,
            propertyFileIds,
          })
          
          // CRITICAL: Verify all expected models are linked via join table
          // Retry querying until all models are visible (browser environments may have delays)
          const expectedModelNames = Object.keys(schemaFile.models || {})
          const { modelSchemas } = await import('../seedSchema/ModelSchemaSchema')
          const { models: modelsTable } = await import('../seedSchema/ModelSchema')
          const { eq, and } = await import('drizzle-orm')
          
          let allModelsLinked = false
          for (let attempt = 0; attempt < 10; attempt++) {
            const modelLinks = await db
              .select({
                modelId: modelSchemas.modelId,
                modelName: modelsTable.name,
              })
              .from(modelSchemas)
              .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
              .where(eq(modelSchemas.schemaId, schemaRecord.id))
            
            const linkedModelNames = modelLinks
              .map((link: { modelId: number | null; modelName: string | null }) => link.modelName)
              .filter((n: string | null): n is string => n !== null)
            
            const missingModels = expectedModelNames.filter(name => !linkedModelNames.includes(name))
            
            if (missingModels.length === 0) {
              console.log(`[importJsonSchema] All ${expectedModelNames.length} expected models are linked: ${linkedModelNames.join(', ')}`)
              allModelsLinked = true
              break
            } else {
              console.log(`[importJsonSchema] Attempt ${attempt + 1}/10: Missing models: ${missingModels.join(', ')}, Linked: ${linkedModelNames.join(', ')}`)
              if (attempt < 9) {
                await new Promise(resolve => setTimeout(resolve, 200))
              }
            }
          }
          
          if (!allModelsLinked) {
            const finalLinks = await db
              .select({ modelName: modelsTable.name })
              .from(modelSchemas)
              .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
              .where(eq(modelSchemas.schemaId, schemaRecord.id))
            const finalLinkedNames = finalLinks.map((l: any) => l.modelName).filter(Boolean)
            const stillMissing = expectedModelNames.filter(name => !finalLinkedNames.includes(name))
            
            console.warn(`[importJsonSchema] WARNING: Not all expected models are linked after retries. Expected: ${expectedModelNames.join(', ')}, Linked: ${finalLinkedNames.join(', ')}, Still missing: ${stillMissing.join(', ') || 'none'}`)
            
            // Try to link missing models directly by finding them in the database
            if (stillMissing.length > 0) {
              console.log(`[importJsonSchema] Attempting to link missing models directly: ${stillMissing.join(', ')}`)
              for (const missingModelName of stillMissing) {
                try {
                  const modelFileId = modelFileIds.get(missingModelName)
                  if (modelFileId) {
                    // Find model by schemaFileId
                    const missingModel = await db
                      .select()
                      .from(modelsTable)
                      .where(eq(modelsTable.schemaFileId, modelFileId))
                      .limit(1)
                    
                    if (missingModel.length > 0 && missingModel[0].id) {
                      // Check if join entry already exists
                      const existingJoin = await db
                        .select()
                        .from(modelSchemas)
                        .where(
                          and(
                            eq(modelSchemas.modelId, missingModel[0].id),
                            eq(modelSchemas.schemaId, schemaRecord.id)
                          )
                        )
                        .limit(1)
                      
                      if (existingJoin.length === 0) {
                        console.log(`[importJsonSchema] Creating missing join table entry for "${missingModelName}" (modelId: ${missingModel[0].id})`)
                        await db.insert(modelSchemas).values({
                          modelId: missingModel[0].id,
                          schemaId: schemaRecord.id,
                        })
                        console.log(`[importJsonSchema] Successfully linked missing model "${missingModelName}"`)
                      } else {
                        console.log(`[importJsonSchema] Join entry already exists for "${missingModelName}" (modelId: ${missingModel[0].id})`)
                      }
                    } else {
                      console.warn(`[importJsonSchema] Could not find model "${missingModelName}" with schemaFileId "${modelFileId}" in database`)
                    }
                  } else {
                    // Fallback: find by name
                    const missingModel = await db
                      .select()
                      .from(modelsTable)
                      .where(eq(modelsTable.name, missingModelName))
                      .limit(1)
                    
                    if (missingModel.length > 0 && missingModel[0].id) {
                      const existingJoin = await db
                        .select()
                        .from(modelSchemas)
                        .where(
                          and(
                            eq(modelSchemas.modelId, missingModel[0].id),
                            eq(modelSchemas.schemaId, schemaRecord.id)
                          )
                        )
                        .limit(1)
                      
                      if (existingJoin.length === 0) {
                        console.log(`[importJsonSchema] Creating missing join table entry for "${missingModelName}" (modelId: ${missingModel[0].id}) by name`)
                        await db.insert(modelSchemas).values({
                          modelId: missingModel[0].id,
                          schemaId: schemaRecord.id,
                        })
                        console.log(`[importJsonSchema] Successfully linked missing model "${missingModelName}" by name`)
                      }
                    } else {
                      console.warn(`[importJsonSchema] Could not find model "${missingModelName}" by name in database`)
                    }
                  }
                } catch (error: any) {
                  console.error(`[importJsonSchema] Error linking missing model "${missingModelName}":`, error?.message || String(error))
                }
              }
            }
          }
          
          // Verify properties are persisted (important for browser environments)
          // Wait a bit for database writes to be visible (browser environments may have delays)
          await new Promise(resolve => setTimeout(resolve, 200))
          
          console.log(`[importJsonSchema] Starting property verification for schema "${schemaName}" (schemaRecord.id: ${schemaRecord.id})`)
          // Note: modelSchemas, modelsTable, and eq are already imported above (lines 557-559), reusing them here
          
          // Try to find models directly by schemaFileId first (more reliable than join table)
          const seedModelId = modelFileIds.get('Seed')
          let seedModel: any[] = []
          if (seedModelId) {
            // Retry querying for the model until it's visible
            for (let attempt = 0; attempt < 10; attempt++) {
              seedModel = await db
                .select()
                .from(modelsTable)
                .where(eq(modelsTable.schemaFileId, seedModelId))
                .limit(1)
              
              if (seedModel.length > 0 && seedModel[0].id) {
                break
              }
              
              if (attempt < 9) {
                await new Promise(resolve => setTimeout(resolve, 100))
              }
            }
            
            if (seedModel.length > 0 && seedModel[0].id) {
              console.log(`[importJsonSchema] Found Seed model (modelId: ${seedModel[0].id}), verifying properties`)
              await verifyPropertiesPersisted(db, seedModel[0].id, 'Seed', 10, 100)
            } else {
              console.log(`[importJsonSchema] WARNING: Could not find Seed model after retries`)
            }
          }
          
          // Also verify via join table if schemaRecord.id is available (for completeness)
          if (schemaRecord.id) {
            // Retry querying join table until entries are visible
            let modelLinks: any[] = []
            for (let attempt = 0; attempt < 10; attempt++) {
              modelLinks = await db
                .select({
                  modelId: modelSchemas.modelId,
                  modelName: modelsTable.name,
                })
                .from(modelSchemas)
                .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
                .where(eq(modelSchemas.schemaId, schemaRecord.id))
              
              if (modelLinks.length > 0) {
                break
              }
              
              if (attempt < 9) {
                await new Promise(resolve => setTimeout(resolve, 100))
              }
            }
            
            logger(`Verifying properties: found ${modelLinks.length} model links for schema ${schemaName} (id: ${schemaRecord.id})`)
            
            // If we didn't verify via direct lookup, verify via join table
            if (!seedModelId || (seedModel.length === 0 || !seedModel[0].id)) {
              const seedModelLink = modelLinks.find((link: { modelId: number | null; modelName: string | null }) => link.modelName === 'Seed')
              if (seedModelLink && seedModelLink.modelId) {
                logger(`Verifying properties for Seed model via join table (modelId: ${seedModelLink.modelId})`)
                await verifyPropertiesPersisted(db, seedModelLink.modelId, 'Seed', 10, 100)
              } else if (modelLinks.length > 0 && modelLinks[0].modelId) {
                // Fallback to first model if Seed not found
                logger(`Verifying properties for ${modelLinks[0].modelName} model via join table (modelId: ${modelLinks[0].modelId})`)
                await verifyPropertiesPersisted(db, modelLinks[0].modelId, modelLinks[0].modelName || 'unknown', 10, 100)
              }
            }
          }
          
          // After properties are created, ensure schemaFile has the correct IDs from database
          // Query the database to get the actual schemaFileId values that were used
          // This ensures schemaData matches what's actually in the database
          const { properties: propertiesTable } = await import('../seedSchema/ModelSchema')
          
          let schemaFileUpdated = false
          for (const [modelName, modelFileId] of modelFileIds.entries()) {
            // Get model record to find modelId
            const modelRecords = await db
              .select()
              .from(modelsTable)
              .where(eq(modelsTable.schemaFileId, modelFileId))
              .limit(1)
            
            if (modelRecords.length > 0) {
              const modelId = modelRecords[0].id
              
              // Get all properties for this model from database
              const propertyRecords = await db
                .select()
                .from(propertiesTable)
                .where(eq(propertiesTable.modelId, modelId))
              
              // Update schemaFile with actual database IDs (only if they differ)
              for (const propRecord of propertyRecords) {
                if (propRecord.schemaFileId && schemaFile.models[modelName]?.properties[propRecord.name]) {
                  const currentId = schemaFile.models[modelName].properties[propRecord.name].id
                  if (currentId !== propRecord.schemaFileId) {
                    schemaFile.models[modelName].properties[propRecord.name].id = propRecord.schemaFileId
                    logger(`Updated schemaFile property ID for ${modelName}.${propRecord.name} from ${currentId} to ${propRecord.schemaFileId}`)
                    schemaFileUpdated = true
                  }
                }
              }
            }
          }
          
          // Always update schemaData to ensure it matches the current schemaFile state
          // This is important even if nothing changed, to ensure consistency
          const updatedSchemaData = JSON.stringify(schemaFile, null, 2)
          
          // Update the schema record in the database with current schemaData
          const { schemas: schemasTable } = await import('../seedSchema/SchemaSchema')
          await db
            .update(schemasTable)
            .set({ schemaData: updatedSchemaData })
            .where(eq(schemasTable.id, schemaRecord.id))
          
          if (schemaFileUpdated) {
            logger(`Updated schemaData in database with actual property IDs for schema "${schemaName}"`)
          } else {
            logger(`Verified schemaData in database matches schemaFile for schema "${schemaName}"`)
          }
        }
      }
    } catch (dbError) {
      // Database not available - log warning but continue
      logger('Database not available, skipping database operations:', dbError instanceof Error ? dbError.message : String(dbError))
    }

    // Models are now Model instances, no registration needed
    // They should be created via Model.create() and are accessible via Model static methods
    for (const [modelName] of Object.entries(modelDefinitions)) {
      logger('loadSchemaFromFile (internal) - model available:', modelName)
    }

    // Schema is now saved to database
    // useSchemas hook will pick it up via database queries

    return '' // Return empty string to indicate no file was created
  }

  const workingDir = BaseFileManager.getWorkingDir()
  const path = BaseFileManager.getPathModule()

  // Ensure schema ID is defined (should always be set by this point, but check for safety)
  if (!schemaFile.id) {
    schemaFile.id = generateId()
    logger('Generated schema ID before file path creation:', schemaFile.id)
  }

  // Get the target file path using ID-based naming (preferred)
  const filePath = getSchemaFilePath(workingDir, schemaFile.metadata.name, version, schemaFile.id)
  
  // Check if schema already exists
  const exists = await BaseFileManager.pathExists(filePath)
  if (exists) {
    // If we have a file path and the import file is the same as the target file,
    // and it's already a complete schema, just load it without writing
    if (importFilePath) {
      const normalizedImportPath = path.resolve(importFilePath)
      const normalizedTargetPath = path.resolve(filePath)
      
      if (normalizedImportPath === normalizedTargetPath) {
        // Check if the file is already a complete schema
        try {
          const content = await BaseFileManager.readFileAsString(importFilePath)
          const data = JSON.parse(content) as any
          if (data.$schema) {
            // File is already a complete schema, just load it
            logger(`Schema file ${filePath} already exists and is complete, loading it`)
            return await loadSchemaFromFile(filePath)
          }
        } catch (error) {
          // If we can't read the file, proceed with the error
        }
      }
    }
    
    // File exists - check if it matches the schema we're trying to import
    try {
      const existingContent = await BaseFileManager.readFileAsString(filePath)
      const existingSchema = JSON.parse(existingContent) as SchemaFileFormat
      
      // Verify it's a complete schema file
      if (existingSchema.$schema) {
        // Compare schemas structurally
        if (compareSchemasStructurally(schemaFile, existingSchema)) {
          // Schemas match - just load the existing file
          logger(`Schema ${schemaFile.metadata.name} v${version} already exists with matching content, loading it`)
          return await loadSchemaFromFile(filePath)
        } else {
          // Schemas don't match - throw error to prevent data loss
          throw new Error(
            `Schema ${schemaFile.metadata.name} v${version} already exists with different content. ` +
            `To update the schema, delete the existing file first or use a different version.`,
          )
        }
      } else {
        // File exists but is not a complete schema - this shouldn't happen with ID-based naming
        // but we'll treat it as a conflict
        throw new Error(
          `Schema ${schemaFile.metadata.name} v${version} already exists but file is not a complete schema`,
        )
      }
    } catch (error) {
      // If error is already our custom error, re-throw it
      if (error instanceof Error && error.message.includes('already exists')) {
        throw error
      }
      // If we can't read/parse the existing file, throw a generic error
      throw new Error(
        `Schema ${schemaFile.metadata.name} v${version} already exists but could not be read: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Ensure working directory exists
  await BaseFileManager.createDirIfNotExists(workingDir)

  // Write schema to file
  const content = JSON.stringify(schemaFile, null, 2)
  await BaseFileManager.saveFile(filePath, content)

  // Wait for the file to be available and readable before trying to read it
  // This is necessary in browser environments where file writes may not be immediately readable
  await BaseFileManager.waitForFileWithContent(filePath, 100, 5000)

  // Load the schema file to process models and add them to the store
  // This handles all model creation, database operations, and store updates
  await loadSchemaFromFile(filePath)

  // Schema is now saved to database
  // useSchemas hook will pick it up via database queries

  return filePath
}

/**
 * Load an existing complete schema file and process its models
 * This is used to load models from already-processed schema files into the store
 * @param schemaFilePath - Path to the complete schema file (must have $schema field)
 * @returns The file path of the schema
 * @throws Error if file cannot be read, parsed, or is not a complete schema
 */
export const loadSchemaFromFile = async (
  schemaFilePath: string,
): Promise<string> => {
  try {
    // Read and parse the schema file
    const content = await BaseFileManager.readFileAsString(schemaFilePath)
    const schemaFile = JSON.parse(content) as SchemaFileFormat

    // Verify it's a complete schema file
    if (!schemaFile.$schema) {
      throw new Error(
        `File ${schemaFilePath} is not a complete schema file (missing $schema field). Use importJsonSchema() for minimal format files.`,
      )
    }

    // Extract schema name and version
    const schemaName = schemaFile.metadata?.name
    const version = schemaFile.version

    if (!schemaName) {
      throw new Error('Schema name is required in metadata.name')
    }

    // Convert to JsonImportSchema format for processing
    // Remove id fields for JsonImportSchema format (they're not part of the import format)
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
              Object.entries(model.properties).map(([propName, prop]) => {
                const schemaProp = prop as any
                const jsonProp: any = {
                  type: schemaProp.dataType || schemaProp.type,
                  // Remove id field for import format
                  id: undefined,
                }
                
                // Handle Relation type - convert ref to model
                if (schemaProp.ref || schemaProp.refModelName) {
                  jsonProp.model = schemaProp.refModelName || schemaProp.ref
                }
                
                // Handle List type
                if ((schemaProp.dataType === 'List' || schemaProp.type === 'List') && schemaProp.refValueType) {
                  jsonProp.items = {
                    type: schemaProp.refValueType,
                    model: schemaProp.refModelName || schemaProp.ref,
                  }
                }
                
                // Copy other properties (storage, etc.)
                Object.keys(schemaProp).forEach(key => {
                  if (key !== 'id' && key !== 'dataType' && key !== 'type' && key !== 'ref' && key !== 'refModelName' && key !== 'refValueType') {
                    jsonProp[key] = schemaProp[key]
                  }
                })
                
                return [propName, jsonProp]
              }),
            ),
          },
        ]),
      ) as unknown as JsonImportSchema['models'],
    }

    // Generate schema ID if missing (before creating schemaInput)
    if (!schemaFile.id) {
      schemaFile.id = generateId()
      logger('Generated schema ID for schema file:', schemaFile.id)
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
      for (const [propName, prop] of Object.entries(model.properties)) {
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

    logger('loadSchemaFromFile - modelDefinitions length:', Object.keys(modelDefinitions).length)

    // Convert schema file metadata to schema input for database
    const schemaInput = {
      name: schemaName,
      version,
      schemaFileId: schemaFile.id || null,
      createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
      updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
    } as Parameters<typeof addSchemaToDb>[0]

    // Use dynamic import to break circular dependency
    const { addSchemaToDb, addModelsToDb } = await import('../helpers/db')
    
    // Try to add schema and models to database if database is available
    try {
      const db = BaseDb.getAppDb()
      if (db) {
        // Store full schema data in database as fallback when file is not available
        // schemaFile already has all IDs (from JSON file or generated), so we can use it directly
        const schemaData = JSON.stringify(schemaFile, null, 2)
        
        // Add schema to database (creates or returns existing) with schemaFileId and schemaData
        const schemaRecord = await addSchemaToDb(schemaInput, schemaFile.id, schemaData, false)

        // Add models to database and link them to the schema with schemaFileIds (only if there are models)
        if (Object.keys(modelDefinitions).length > 0) {
          await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
            schemaFileId: schemaFile.id,
            modelFileIds,
            propertyFileIds,
          })
          
          // Verify properties are persisted (important for browser environments)
          // Wait a bit for database writes to be visible (browser environments may have delays)
          await new Promise(resolve => setTimeout(resolve, 200))
          
          console.log(`[importJsonSchema] Starting property verification for schema "${schemaName}" (schemaRecord.id: ${schemaRecord.id})`)
          // Query the database to get model IDs that were just created
          const { modelSchemas } = await import('../seedSchema/ModelSchemaSchema')
          const { models: modelsTable } = await import('../seedSchema/ModelSchema')
          const { eq } = await import('drizzle-orm')
          
          // Try to find models directly by schemaFileId first (more reliable than join table)
          const seedModelId = modelFileIds.get('Seed')
          let seedModel: any[] = []
          if (seedModelId) {
            // Retry querying for the model until it's visible
            for (let attempt = 0; attempt < 10; attempt++) {
              seedModel = await db
                .select()
                .from(modelsTable)
                .where(eq(modelsTable.schemaFileId, seedModelId))
                .limit(1)
              
              if (seedModel.length > 0 && seedModel[0].id) {
                break
              }
              
              if (attempt < 9) {
                await new Promise(resolve => setTimeout(resolve, 100))
              }
            }
            
            if (seedModel.length > 0 && seedModel[0].id) {
              console.log(`[importJsonSchema] Found Seed model (modelId: ${seedModel[0].id}), verifying properties`)
              await verifyPropertiesPersisted(db, seedModel[0].id, 'Seed', 10, 100)
            } else {
              console.log(`[importJsonSchema] WARNING: Could not find Seed model after retries`)
            }
          }
          
          // Also verify via join table if schemaRecord.id is available (for completeness)
          if (schemaRecord.id) {
            // Retry querying join table until entries are visible
            let modelLinks: any[] = []
            for (let attempt = 0; attempt < 10; attempt++) {
              modelLinks = await db
                .select({
                  modelId: modelSchemas.modelId,
                  modelName: modelsTable.name,
                })
                .from(modelSchemas)
                .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
                .where(eq(modelSchemas.schemaId, schemaRecord.id))
              
              if (modelLinks.length > 0) {
                break
              }
              
              if (attempt < 9) {
                await new Promise(resolve => setTimeout(resolve, 100))
              }
            }
            
            logger(`Verifying properties: found ${modelLinks.length} model links for schema ${schemaName} (id: ${schemaRecord.id})`)
            
            // If we didn't verify via direct lookup, verify via join table
            if (!seedModelId || (seedModel.length === 0 || !seedModel[0].id)) {
              const seedModelLink = modelLinks.find((link: { modelId: number | null; modelName: string | null }) => link.modelName === 'Seed')
              if (seedModelLink && seedModelLink.modelId) {
                logger(`Verifying properties for Seed model via join table (modelId: ${seedModelLink.modelId})`)
                await verifyPropertiesPersisted(db, seedModelLink.modelId, 'Seed', 10, 100)
              } else if (modelLinks.length > 0 && modelLinks[0].modelId) {
                // Fallback to first model if Seed not found
                logger(`Verifying properties for ${modelLinks[0].modelName} model via join table (modelId: ${modelLinks[0].modelId})`)
                await verifyPropertiesPersisted(db, modelLinks[0].modelId, modelLinks[0].modelName || 'unknown', 10, 100)
              }
            }
          }
          
          // After properties are created, ensure schemaFile has the correct IDs from database
          // Query the database to get the actual schemaFileId values that were used
          // This ensures schemaData matches what's actually in the database
          const { properties: propertiesTable } = await import('../seedSchema/ModelSchema')
          
          let schemaFileUpdated = false
          for (const [modelName, modelFileId] of modelFileIds.entries()) {
            // Get model record to find modelId
            const modelRecords = await db
              .select()
              .from(modelsTable)
              .where(eq(modelsTable.schemaFileId, modelFileId))
              .limit(1)
            
            if (modelRecords.length > 0) {
              const modelId = modelRecords[0].id
              
              // Get all properties for this model from database
              const propertyRecords = await db
                .select()
                .from(propertiesTable)
                .where(eq(propertiesTable.modelId, modelId))
              
              // Update schemaFile with actual database IDs (only if they differ)
              for (const propRecord of propertyRecords) {
                if (propRecord.schemaFileId && schemaFile.models[modelName]?.properties[propRecord.name]) {
                  const currentId = schemaFile.models[modelName].properties[propRecord.name].id
                  if (currentId !== propRecord.schemaFileId) {
                    schemaFile.models[modelName].properties[propRecord.name].id = propRecord.schemaFileId
                    logger(`Updated schemaFile property ID for ${modelName}.${propRecord.name} from ${currentId} to ${propRecord.schemaFileId}`)
                    schemaFileUpdated = true
                  }
                }
              }
            }
          }
          
          // Always update schemaData to ensure it matches the current schemaFile state
          // This is important even if nothing changed, to ensure consistency
          const updatedSchemaData = JSON.stringify(schemaFile, null, 2)
          
          // Update the schema record in the database with current schemaData
          const { schemas: schemasTable } = await import('../seedSchema/SchemaSchema')
          await db
            .update(schemasTable)
            .set({ schemaData: updatedSchemaData })
            .where(eq(schemasTable.id, schemaRecord.id))
          
          if (schemaFileUpdated) {
            logger(`Updated schemaData in database with actual property IDs for schema "${schemaName}"`)
          } else {
            logger(`Verified schemaData in database matches schemaFile for schema "${schemaName}"`)
          }
        }
      }
    } catch (dbError) {
      // Database not available - log warning but continue
      logger('Database not available, skipping database operations:', dbError instanceof Error ? dbError.message : String(dbError))
    }

    // Models are now Model instances, no registration needed
    // They should be created via Model.create() and are accessible via Model static methods
    for (const [modelName] of Object.entries(modelDefinitions)) {
      logger('loadSchemaFromFile - model available:', modelName)
    }

    return schemaFilePath
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in file ${schemaFilePath}: ${error.message}`)
    }
    throw new Error(
      `Failed to load schema from file ${schemaFilePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Create a Model class from a JSON model definition
 * @param modelName - The name of the model
 * @param modelDef - The JSON model definition
 * @param schemaName - The name of the schema this model belongs to
 * @returns A Model class that can be used with the SDK
 */
export const createModelFromJson = async (
  modelName: string,
  modelDef: JsonImportSchema['models'][string],
  schemaName: string,
  modelFileId?: string, // Optional modelFileId from JSON file
  propertyFileIds?: Map<string, string>, // Optional map of property names to their file IDs from the JSON file
): Promise<any> => {
  const { Model } = await import('../Model/Model')
  
  // Convert JSON properties to schema format
  const convertedProperties: { [propName: string]: any } = {}
  if (modelDef.properties) {
    for (const [propName, propDef] of Object.entries(modelDef.properties)) {
      // JSON import format: { type, model, items, storage: { type, path, extension } }
      // Schema format: { dataType, ref, refValueType, storageType, localStorageDir, filenameSuffix }
      const jsonProp = propDef as any
      const schemaProp: any = {
        dataType: jsonProp.type,
      }

      // Include property ID if available from propertyFileIds map
      // This ensures the property uses the correct ID from the schema file
      const propertyFileId = propertyFileIds?.get(propName)
      if (propertyFileId) {
        schemaProp.id = propertyFileId
      }

      // Handle Relation type
      if (jsonProp.model) {
        schemaProp.ref = jsonProp.model
        schemaProp.refModelName = jsonProp.model
      }

      // Handle List type
      if (jsonProp.type === 'List' && jsonProp.items) {
        schemaProp.refValueType = jsonProp.items.type
        schemaProp.ref = jsonProp.items.model || jsonProp.model
        schemaProp.refModelName = jsonProp.items.model || jsonProp.model
      }

      // Handle storage configuration
      if (jsonProp.storage) {
        schemaProp.storageType = jsonProp.storage.type === 'ItemStorage' ? 'ItemStorage' : 'PropertyStorage'
        schemaProp.localStorageDir = jsonProp.storage.path
        schemaProp.filenameSuffix = jsonProp.storage.extension
      }

      convertedProperties[propName] = schemaProp
    }
  }

  // Create Model instance with the definition
  // Pass id (schemaFileId) if provided to ensure Model instance uses correct ID
  // Note: indexes and description are ignored - they remain in JSON for schema file format compliance but are not used by Model instances
  if (modelFileId) {
    logger(`Creating schema model "${modelName}" with modelFileId: ${modelFileId}`)
  } else {
    logger(`Warning: Creating schema model "${modelName}" without modelFileId - it will be renamed if duplicates exist`)
  }
  const modelInstance = Model.create(modelName, schemaName, {
    modelFileId: modelFileId, // Pass modelFileId (preferred) as id (schemaFileId) from JSON file
    id: modelFileId, // Also pass as id for backward compatibility
    properties: convertedProperties,
    waitForReady: false,
  }) as import('@/Model/Model').Model

  return modelInstance
}

/**
 * Convert JSON import schema to ModelDefinitions
 * @param importData - The JSON import data
 * @param modelFileIds - Optional map of model names to their file IDs from the JSON file
 * @param propertyFileIds - Optional map of model names to maps of property names to their file IDs from the JSON file
 * @returns ModelDefinitions object with Model classes
 */
export const createModelsFromJson = async (
  importData: JsonImportSchema,
  modelFileIds?: Map<string, string>,
  propertyFileIds?: Map<string, Map<string, string>>,
): Promise<ModelDefinitions> => {
  const modelDefinitions: ModelDefinitions = {}
  const schemaName = importData.name

  for (const [modelName, modelDef] of Object.entries(importData.models)) {
    // Get modelFileId from map if available
    const modelFileId = modelFileIds?.get(modelName)
    // Use modelFileId from map (no fallback to modelDef.id as JsonImportSchema doesn't have id property)
    const finalModelFileId = modelFileId
    if (!finalModelFileId) {
      logger(`Warning: No modelFileId found for model "${modelName}" - model will be created without ID`)
    }
    // Get propertyFileIds for this model if available
    const modelPropertyFileIds = propertyFileIds?.get(modelName)
    const ModelClass = await createModelFromJson(modelName, modelDef, schemaName, finalModelFileId, modelPropertyFileIds)
    
    modelDefinitions[modelName] = ModelClass as unknown as ModelClassType
  }

  return modelDefinitions
}

/**
 * Read a JSON import file and create Model classes from it
 * @param filePath - Path to the JSON import file
 * @returns ModelDefinitions with Model classes created from the JSON schema
 */
export const createModelsFromJsonFile = async (
  filePath: string,
): Promise<ModelDefinitions> => {
  const importData = await readJsonImportFile(filePath)
  return createModelsFromJson(importData)
}

