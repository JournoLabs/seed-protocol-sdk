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

const logger = debug('seedSdk:imports:json')

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
  let importData: JsonImportSchema
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
  } else {
    schemaFile = transformImportToSchemaFile(importData, version)
  }

  // Check if this is an internal SDK schema (should not create files in app directory)
  const { isInternalSchema } = await import('@/helpers/constants')
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
              Object.entries(model.properties || {}).map(([propName, prop]) => [
                propName,
                {
                  ...prop,
                  // Remove id field for import format
                  id: undefined,
                },
              ]),
            ),
          },
        ]),
      ) as JsonImportSchema['models'],
    }

    // Convert JSON models to Model classes
    const modelDefinitions = await createModelsFromJson(importDataForInternal)

    logger('loadSchemaFromFile (internal) - modelDefinitions length:', Object.keys(modelDefinitions).length)

    // Convert schema file metadata to schema input for database
    const schemaInput = {
      name: schemaName,
      version,
      schemaFileId: schemaFile.id || null,
      createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
      updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
    } as Parameters<typeof addSchemaToDb>[0]

    // Extract schemaFileIds from JSON file
    const modelFileIds = new Map<string, string>()
    const propertyFileIds = new Map<string, Map<string, string>>()
    
    for (const [modelName, model] of Object.entries(schemaFile.models || {})) {
      if (model.id) {
        modelFileIds.set(modelName, model.id)
      }
      
      const propIds = new Map<string, string>()
      for (const [propName, prop] of Object.entries(model.properties || {})) {
        if (prop.id) {
          propIds.set(propName, prop.id)
        }
      }
      if (propIds.size > 0) {
        propertyFileIds.set(modelName, propIds)
      }
    }

    // Use dynamic import to break circular dependency
    const { addSchemaToDb, addModelsToDb } = await import('@/helpers/db')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    
    // Try to add schema and models to database if database is available
    try {
      const db = BaseDb.getAppDb()
      if (db) {
        // Store full schema data in database as fallback when file is not available
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
              Object.entries(model.properties).map(([propName, prop]) => [
                propName,
                {
                  ...prop,
                  // Remove id field for import format
                  id: undefined,
                },
              ]),
            ),
          },
        ]),
      ) as JsonImportSchema['models'],
    }

    // Convert JSON models to Model classes
    const modelDefinitions = await createModelsFromJson(importData)

    logger('loadSchemaFromFile - modelDefinitions length:', Object.keys(modelDefinitions).length)

    // Convert schema file metadata to schema input for database
    const schemaInput = {
      name: schemaName,
      version,
      schemaFileId: schemaFile.id || null,
      createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
      updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
    } as Parameters<typeof addSchemaToDb>[0]

    // Extract schemaFileIds from JSON file
    const modelFileIds = new Map<string, string>()
    const propertyFileIds = new Map<string, Map<string, string>>()
    
    for (const [modelName, model] of Object.entries(schemaFile.models || {})) {
      if (model.id) {
        modelFileIds.set(modelName, model.id)
      }
      
      const propIds = new Map<string, string>()
      for (const [propName, prop] of Object.entries(model.properties)) {
        if (prop.id) {
          propIds.set(propName, prop.id)
        }
      }
      if (propIds.size > 0) {
        propertyFileIds.set(modelName, propIds)
      }
    }

    // Use dynamic import to break circular dependency
    const { addSchemaToDb, addModelsToDb } = await import('@/helpers/db')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    
    // Try to add schema and models to database if database is available
    try {
      const db = BaseDb.getAppDb()
      if (db) {
        // Store full schema data in database as fallback when file is not available
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
 * Convert a JSON property definition to a Property definition
 * @param propertyDef - The JSON property definition
 * @returns A Property definition that can be used with the Model decorator
 */
const convertJsonPropertyToProperty = (
  propertyDef: JsonImportSchema['models'][string]['properties'][string],
): Static<typeof TProperty> => {
  const { type, model, items, storage } = propertyDef

  switch (type) {
    case ModelPropertyDataTypes.Text:
      // Handle storage configuration for Text properties
      const storageType = storage?.type === 'ItemStorage' ? 'ItemStorage' : 
                         storage?.type === 'PropertyStorage' ? 'PropertyStorage' : 
                         undefined
      return Property.Text(
        storageType,
        storage?.path,
        storage?.extension,
      )
    case ModelPropertyDataTypes.Number:
      return Property.Number()
    case ModelPropertyDataTypes.Boolean:
      return Property.Boolean()
    case ModelPropertyDataTypes.Date:
      return Property.Date()
    case ModelPropertyDataTypes.Image:
      return Property.Image()
    case ModelPropertyDataTypes.Json:
      return Property.Json()
    case ModelPropertyDataTypes.File:
      return Property.File()
    case ModelPropertyDataTypes.Relation:
      if (!model) {
        throw new Error(
          `Model is required for Relation property type`,
        )
      }
      return Property.Relation(model)
    case ModelPropertyDataTypes.List:
      if (!items) {
        throw new Error('Items configuration is required for List property type')
      }
      if (items.type === ModelPropertyDataTypes.Relation && items.model) {
        return Property.List(items.model, items.type as any)
      }
      throw new Error(
        `Unsupported List items type: ${items.type}. Only Relation with model is currently supported.`,
      )
    default:
      throw new Error(`Unknown property type: ${type}`)
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
): Promise<any> => {
  const { Model } = await import('@/Model')
  
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
  const modelInstance = Model.create(modelName, schemaName, {
    properties: convertedProperties,
    description: modelDef.description,
    indexes: modelDef.indexes,
  })

  return modelInstance
}

/**
 * Convert JSON import schema to ModelDefinitions
 * @param importData - The JSON import data
 * @returns ModelDefinitions object with Model classes
 */
export const createModelsFromJson = async (
  importData: JsonImportSchema,
): Promise<ModelDefinitions> => {
  const modelDefinitions: ModelDefinitions = {}
  const schemaName = importData.name

  for (const [modelName, modelDef] of Object.entries(importData.models)) {
    const ModelClass = await createModelFromJson(modelName, modelDef, schemaName)
    
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

