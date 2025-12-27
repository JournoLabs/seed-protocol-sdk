import { BaseFileManager } from '../helpers/FileManager/BaseFileManager'
import { JsonImportSchema, SchemaFileFormat } from '../types/import'
import { ModelPropertyDataTypes } from '@/schema'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/schema/property'
import { ModelDefinitions, ModelClassType } from '@/types'
// Dynamic import to break circular dependency with helpers/db -> ModelProperty -> updateSchema -> imports/json
// import { addModelsToDb, addSchemaToDb } from '@/helpers/db'
import { generateId } from '@/helpers'
import debug from 'debug'
import { setModel } from '@/stores/modelClass'
// Dynamic import to break circular dependency: ClientManager -> processSchemaFiles -> imports/json -> ClientManager
// import { getClient } from '@/client/ClientManager'
import { ClientManagerEvents } from '@/services/internal/constants'

const logger = debug('seedSdk:imports:json')


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

    if (!data.models || Object.keys(data.models).length === 0) {
      throw new Error('At least one model is required')
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
 * Get the full file path for a schema file
 */
const getSchemaFilePath = (workingDir: string, name: string, version: number): string => {
  const path = BaseFileManager.getPathModule()
  // Sanitize name to be filesystem-safe
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = `${sanitizedName}-v${version}.json`
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

  if (typeof importFilePathOrContents === 'string') {
    // It's a file path
    importFilePath = importFilePathOrContents
    importData = await readJsonImportFile(importFilePath)
  } else {
    // It's file contents
    importData = parseJsonImportContent(importFilePathOrContents.contents)
  }

  // Transform to full schema file format
  const schemaFile = transformImportToSchemaFile(importData, version)

  const workingDir = BaseFileManager.getWorkingDir()
  const path = BaseFileManager.getPathModule()

  // Get the target file path
  const filePath = getSchemaFilePath(workingDir, schemaFile.metadata.name, version)
  
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
    
    // Target file exists and is different from import file, or import file is not complete
    throw new Error(
      `Schema ${schemaFile.metadata.name} v${version} already exists`,
    )
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

  // Update client context so useSchemas hook reflects the new schema
  try {
    // Use dynamic import to break circular dependency
    const { getClient } = await import('@/client/ClientManager')
    const client = getClient()
    const clientService = client.getService()
    const currentContext = clientService.getSnapshot().context
    
    // Read the schema file content to add to context
    const schemaFileContent = await BaseFileManager.readFileAsString(filePath)
    const schemaData = JSON.parse(schemaFileContent) as SchemaFileFormat
    const schemaName = schemaData.metadata?.name || schemaFile.metadata.name
    
    // Get model definitions for the context
    const modelDefinitions = await createModelsFromJson(importData)
    
    // Update context with the new schema and models
    const updatedSchemas = { ...(currentContext.schemas || {}), [schemaName]: schemaData }
    const updatedModels = { ...(currentContext.models || {}), ...modelDefinitions }
    
    // Send UPDATE_CONTEXT event to update the client context
    clientService.send({
      type: ClientManagerEvents.UPDATE_CONTEXT,
      context: {
        schemas: updatedSchemas,
        models: updatedModels,
      },
    })
    
    logger(`Updated client context with schema: ${schemaName}`)
  } catch (error) {
    // Log error but don't fail the import if context update fails
    logger(`Failed to update client context: ${error instanceof Error ? error.message : String(error)}`)
  }

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

    if (!schemaFile.models || Object.keys(schemaFile.models).length === 0) {
      throw new Error('At least one model is required')
    }

    // Convert to JsonImportSchema format for processing
    // Remove id fields for JsonImportSchema format (they're not part of the import format)
    const importData: JsonImportSchema = {
      name: schemaName,
      models: Object.fromEntries(
        Object.entries(schemaFile.models).map(([modelName, model]) => [
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
    
    for (const [modelName, model] of Object.entries(schemaFile.models)) {
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
    
    // Store full schema data in database as fallback when file is not available
    const schemaData = JSON.stringify(schemaFile, null, 2)
    
    // Add schema to database (creates or returns existing) with schemaFileId and schemaData
    const schemaRecord = await addSchemaToDb(schemaInput, schemaFile.id, schemaData, false)

    // Add models to database and link them to the schema with schemaFileIds
    await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
      schemaFileId: schemaFile.id,
      modelFileIds,
      propertyFileIds,
    })

    // Add models to the store
    for (const [modelName, modelClass] of Object.entries(modelDefinitions)) {
      logger('loadSchemaFromFile - setting model:', modelName)
      setModel(modelName, modelClass)
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
  const { Model } = await import('@/schema/model')
  const { ModelClass } = await import('@/schema/model/ModelClass')
  
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

  // Create Model instance
  const modelInstance = Model.create(modelName, schemaName)
  
  // Update the model instance with the definition
  modelInstance.properties = convertedProperties
  modelInstance.description = modelDef.description
  modelInstance.indexes = modelDef.indexes

  // Create a ModelClass wrapper
  class WrappedModelClass {
    private static _modelInstance = modelInstance

    static get schema() {
      return this._modelInstance.schema
    }

    static async create(values: any) {
      return this._modelInstance.create(values)
    }

    static get modelName() {
      return modelName
    }

    static get schemaName() {
      return schemaName
    }
  }

  return WrappedModelClass
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

