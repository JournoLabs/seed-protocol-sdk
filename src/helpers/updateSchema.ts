import { BaseFileManager } from './FileManager/BaseFileManager'
import { SchemaFileFormat, JsonImportSchema } from '@/types/import'
import { getLatestSchemaVersion } from './schema'
// Dynamic import to break circular dependency with imports/json -> helpers/db -> ModelProperty -> updateSchema
// import { loadSchemaFromFile, createModelsFromJson } from '@/imports/json'
// Dynamic import to break circular dependency: helpers/db -> ModelProperty -> updateSchema -> helpers/db
// import { addModelsToDb, addSchemaToDb } from './db'
import { SchemaType } from '@/seedSchema/SchemaSchema'
import { setModel } from '@/stores/modelClass'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/schema'
import { ModelPropertyDataTypes } from '@/schema/property'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { generateId } from './index'
import debug from 'debug'

const logger = debug('seedSdk:helpers:updateSchema')

/**
 * Schema property update definition
 */
export type SchemaPropertyUpdate = {
  modelName: string
  propertyName: string
  updates: {
    type?: string
    model?: string
    items?: {
      type: string
      model?: string
      [key: string]: any
    }
    storage?: {
      type: string
      path?: string
      extension?: string
    }
    required?: boolean
    description?: string
    validation?: {
      pattern?: string
      [key: string]: any
    }
    [key: string]: any
  }
}

/**
 * Schema model update definition (for renaming models)
 */
export type SchemaModelUpdate = {
  oldName: string
  newName: string
}

/**
 * Options for deletion operations
 */
export type DeleteOptions = {
  /**
   * If true, also remove properties that reference the deleted model
   * If false, properties referencing the model will have their refModelId set to null
   * Default: false
   */
  removeReferencingProperties?: boolean
  /**
   * If true, also delete from database (not just remove from schema)
   * If false, keep in database for historical data
   * Default: false
   */
  deleteFromDatabase?: boolean
}

/**
 * Get the file path for a schema file
 */
const getSchemaFilePath = (name: string, version: number): string => {
  const path = BaseFileManager.getPathModule()
  const workingDir = BaseFileManager.getWorkingDir()
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = `${sanitizedName}-v${version}.json`
  return path.join(workingDir, filename)
}

/**
 * Get model name from modelId
 * @param modelId - The model ID to look up
 * @returns The model name, or undefined if not found
 */
export async function getModelNameFromId(modelId: number | undefined): Promise<string | undefined> {
  if (!modelId) {
    return undefined
  }

  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not found')
  }

  const modelRecords = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.id, modelId))
    .limit(1)

  if (modelRecords.length === 0) {
    return undefined
  }

  return modelRecords[0].name
}

/**
 * Convert a TProperty/ModelPropertyMachineContext to SchemaPropertyUpdate format
 * This function converts the internal property representation to the schema file format
 * @param property - The TProperty instance to convert
 * @param modelName - The name of the model this property belongs to
 * @param propertyName - The name of the property
 * @returns A SchemaPropertyUpdate object ready to be passed to updateModelProperties
 */
export async function convertPropertyToSchemaUpdate(
  property: Static<typeof TProperty>,
  modelName: string,
  propertyName: string,
): Promise<SchemaPropertyUpdate> {
  const updates: SchemaPropertyUpdate['updates'] = {}

  // Convert dataType to type
  if (property.dataType) {
    updates.type = property.dataType
  }

  // Handle Relation type
  if (property.dataType === ModelPropertyDataTypes.Relation) {
    if (property.ref) {
      updates.model = property.ref
    } else if (property.refModelId) {
      // If ref is not set but refModelId is, get the model name from the database
      const refModelName = await getModelNameFromId(property.refModelId)
      if (refModelName) {
        updates.model = refModelName
      }
    }
  }

  // Handle List type
  if (property.dataType === ModelPropertyDataTypes.List) {
    if (property.refValueType) {
      updates.items = {
        type: property.refValueType,
      }
      if (property.ref) {
        updates.items.model = property.ref
      } else if (property.refModelId) {
        // If ref is not set but refModelId is, get the model name from the database
        const refModelName = await getModelNameFromId(property.refModelId)
        if (refModelName) {
          updates.items.model = refModelName
        }
      }
    }
  }

  // Handle storage configuration (for Text properties with storage)
  if (property.storageType || property.localStorageDir || property.filenameSuffix) {
    const storageType = property.storageType || 'ItemStorage' // Default to ItemStorage if not specified
    updates.storage = {
      type: storageType,
    }
    
    if (property.localStorageDir) {
      updates.storage.path = property.localStorageDir
    }
    
    if (property.filenameSuffix) {
      updates.storage.extension = property.filenameSuffix
    }
  }

  return {
    modelName,
    propertyName,
    updates,
  }
}

/**
 * Update model properties in a schema and create a new version
 * @param schemaName - The name of the schema to update
 * @param propertyUpdates - Array of property updates to apply
 * @param modelUpdates - Optional array of model renames
 * @returns The file path of the new schema version
 * @throws Error if schema not found or updates are invalid
 */
export async function updateModelProperties(
  schemaName: string,
  propertyUpdates: SchemaPropertyUpdate[],
  modelUpdates?: SchemaModelUpdate[],
): Promise<string> {
  // Get the latest version of the schema
  const latestVersion = await getLatestSchemaVersion(schemaName)
  
  if (latestVersion === 0) {
    throw new Error(`Schema ${schemaName} not found`)
  }

  // Load the latest schema file
  const latestFilePath = getSchemaFilePath(schemaName, latestVersion)
  const content = await BaseFileManager.readFileAsString(latestFilePath)
  const schemaFile = JSON.parse(content) as SchemaFileFormat

  if (!schemaFile.$schema) {
    throw new Error(`Schema file ${latestFilePath} is not a complete schema file`)
  }

  // Create a copy of the schema for the new version
  // Preserve schema ID and all model/property IDs
  const newVersion = latestVersion + 1
  const updatedSchema: SchemaFileFormat = {
    ...schemaFile,
    version: newVersion,
    // Preserve schema ID from previous version
    id: schemaFile.id,
    metadata: {
      ...schemaFile.metadata,
      updatedAt: new Date().toISOString(),
    },
    // Deep copy models to preserve IDs
    models: Object.fromEntries(
      Object.entries(schemaFile.models).map(([modelName, model]) => [
        modelName,
        {
          ...model,
          // Preserve model ID
          id: model.id,
          // Deep copy properties to preserve IDs
          properties: Object.fromEntries(
            Object.entries(model.properties).map(([propName, prop]) => [
              propName,
              {
                ...prop,
                // Preserve property ID
                id: prop.id,
              },
            ]),
          ),
        },
      ]),
    ),
    migrations: [
      ...schemaFile.migrations,
      {
        version: newVersion,
        timestamp: new Date().toISOString(),
        description: `Updated model properties: ${propertyUpdates.map(u => `${u.modelName}.${u.propertyName}`).join(', ')}`,
        changes: propertyUpdates.map(update => ({
          type: 'property_update',
          modelName: update.modelName,
          propertyName: update.propertyName,
          updates: update.updates,
        })),
      },
    ],
  }

  // Apply model renames first (if any)
  if (modelUpdates && modelUpdates.length > 0) {
    for (const modelUpdate of modelUpdates) {
      if (updatedSchema.models[modelUpdate.oldName]) {
        // Rename the model in the models object
        updatedSchema.models[modelUpdate.newName] = updatedSchema.models[modelUpdate.oldName]
        delete updatedSchema.models[modelUpdate.oldName]

        // Update any property references to this model
        for (const modelName in updatedSchema.models) {
          const model = updatedSchema.models[modelName]
          for (const propertyName in model.properties) {
            const property = model.properties[propertyName]
            if (property.model === modelUpdate.oldName) {
              property.model = modelUpdate.newName
            }
            if (property.items?.model === modelUpdate.oldName) {
              property.items.model = modelUpdate.newName
            }
          }
        }

        // Add to migration changes
        updatedSchema.migrations[updatedSchema.migrations.length - 1].changes.push({
          type: 'model_rename',
          oldName: modelUpdate.oldName,
          newName: modelUpdate.newName,
        })
      }
    }
  }

  // Apply property updates
  for (const update of propertyUpdates) {
    const model = updatedSchema.models[update.modelName]
    if (!model) {
      throw new Error(`Model ${update.modelName} not found in schema ${schemaName}`)
    }

    if (!model.properties[update.propertyName]) {
      throw new Error(
        `Property ${update.propertyName} not found in model ${update.modelName} of schema ${schemaName}`,
      )
    }

    // Update the property with new values
    const property = model.properties[update.propertyName]
    Object.assign(property, update.updates)
  }

  // Write the new schema version to file
  const newFilePath = getSchemaFilePath(schemaName, newVersion)
  const newContent = JSON.stringify(updatedSchema, null, 2)
  
  await BaseFileManager.saveFile(newFilePath, newContent)

  // Wait for the file to be available with content (important for browser/OPFS where writes may not be immediately readable)
  await BaseFileManager.waitForFileWithContent(newFilePath)

  logger(`Created new schema version ${newVersion} for ${schemaName} at ${newFilePath}`)

  // Load the new schema file to process models and add them to the database
  // Extract model renames from migrations to pass to database update
  const modelRenames = new Map<string, string>()
  const latestMigration = updatedSchema.migrations[updatedSchema.migrations.length - 1]
  for (const change of latestMigration.changes) {
    if (change.type === 'model_rename') {
      modelRenames.set(change.oldName, change.newName)
    }
  }

  // Load schema with model renames handled
  await loadSchemaWithRenames(newFilePath, modelRenames)

  return newFilePath
}

/**
 * Load a schema file and handle model renames in the database
 * This is a helper function that processes model renames before loading
 */
async function loadSchemaWithRenames(
  schemaFilePath: string,
  modelRenames: Map<string, string>,
): Promise<string> {
  const content = await BaseFileManager.readFileAsString(schemaFilePath)
  const schemaFile = JSON.parse(content) as SchemaFileFormat

  if (!schemaFile.$schema) {
    throw new Error(
      `File ${schemaFilePath} is not a complete schema file (missing $schema field).`,
    )
  }

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

  // Use dynamic import to break circular dependency
  const { createModelsFromJson } = await import('@/imports/json')
  
  // Convert JSON models to Model classes
  const modelDefinitions = await createModelsFromJson(importData)

  // Convert schema file metadata to schema input for database
  const schemaInput: Omit<SchemaType, 'id'> = {
    name: schemaName,
    version,
    schemaFileId: schemaFile.id || null,
    createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
    updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
  }

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
  const { addSchemaToDb, addModelsToDb } = await import('./db')
  
  // Add schema to database with schemaFileId
  const schemaRecord = await addSchemaToDb(schemaInput as SchemaType, schemaFile.id)

  // Add models to database with model renames handled and schemaFileIds
  await addModelsToDb(modelDefinitions, schemaRecord, modelRenames, {
    schemaFileId: schemaFile.id,
    modelFileIds,
    propertyFileIds,
  })

  // Add models to the store
  for (const [modelName, modelClass] of Object.entries(modelDefinitions)) {
    logger('loadSchemaWithRenames - setting model:', modelName)
    setModel(modelName, modelClass)
  }

  return schemaFilePath
}

/**
 * Rename a property in a model
 * This is a convenience function that updates the property name
 * Note: This creates a new property and you may want to handle the old property separately
 * @param schemaName - The name of the schema
 * @param modelName - The name of the model
 * @param oldPropertyName - The current property name
 * @param newPropertyName - The new property name
 * @returns The file path of the new schema version
 */
export async function renameModelProperty(
  schemaName: string,
  modelName: string,
  oldPropertyName: string,
  newPropertyName: string,
): Promise<string> {
  // Get the latest version
  const latestVersion = await getLatestSchemaVersion(schemaName)
  if (latestVersion === 0) {
    throw new Error(`Schema ${schemaName} not found`)
  }

  // Load the latest schema file
  const latestFilePath = getSchemaFilePath(schemaName, latestVersion)
  const content = await BaseFileManager.readFileAsString(latestFilePath)
  const schemaFile = JSON.parse(content) as SchemaFileFormat

  if (!schemaFile.$schema) {
    throw new Error(`Schema file ${latestFilePath} is not a complete schema file`)
  }

  const model = schemaFile.models[modelName]
  if (!model) {
    throw new Error(`Model ${modelName} not found in schema ${schemaName}`)
  }

  if (!model.properties[oldPropertyName]) {
    throw new Error(
      `Property ${oldPropertyName} not found in model ${modelName} of schema ${schemaName}`,
    )
  }

  if (model.properties[newPropertyName]) {
    throw new Error(
      `Property ${newPropertyName} already exists in model ${modelName} of schema ${schemaName}`,
    )
  }

  // Create new version with renamed property
  // Preserve all IDs - when renaming, we keep the same property ID
  const newVersion = latestVersion + 1
  const oldProperty = model.properties[oldPropertyName]
  const updatedSchema: SchemaFileFormat = {
    ...schemaFile,
    version: newVersion,
    id: schemaFile.id, // Preserve schema ID
    metadata: {
      ...schemaFile.metadata,
      updatedAt: new Date().toISOString(),
    },
    models: {
      ...schemaFile.models,
      [modelName]: {
        ...model,
        id: model.id, // Preserve model ID
        properties: {
          ...Object.fromEntries(
            Object.entries(model.properties)
              .filter(([name]) => name !== oldPropertyName)
              .map(([name, prop]) => [name, { ...prop, id: prop.id }]),
          ),
          [newPropertyName]: {
            ...oldProperty,
            id: oldProperty.id, // Preserve property ID when renaming
          },
        },
      },
    },
    migrations: [
      ...schemaFile.migrations,
      {
        version: newVersion,
        timestamp: new Date().toISOString(),
        description: `Renamed property ${modelName}.${oldPropertyName} to ${newPropertyName}`,
        changes: [
          {
            type: 'property_rename',
            modelName,
            oldPropertyName,
            newPropertyName,
          },
        ],
      },
    ],
  }

  // Remove the old property name
  delete updatedSchema.models[modelName].properties[oldPropertyName]

  // Write the new schema version
  const newFilePath = getSchemaFilePath(schemaName, newVersion)
  const newContent = JSON.stringify(updatedSchema, null, 2)
  
  // Ensure the directory exists before saving
  const path = BaseFileManager.getPathModule()
  const dir = path.dirname(newFilePath)
  await BaseFileManager.createDirIfNotExists(dir)
  
  await BaseFileManager.saveFile(newFilePath, newContent)

  // Wait for the file to be available with content (important for browser/OPFS where writes may not be immediately readable)
  await BaseFileManager.waitForFileWithContent(newFilePath)

  logger(`Renamed property ${oldPropertyName} to ${newPropertyName} in schema ${schemaName} v${newVersion}`)

  // Use dynamic import to break circular dependency
  const { loadSchemaFromFile } = await import('@/imports/json')
  
  // Load the new schema file
  await loadSchemaFromFile(newFilePath)

  return newFilePath
}

/**
 * Delete a model from a schema
 * @param schemaName - The name of the schema
 * @param modelName - The name of the model to delete
 * @param options - Optional deletion options
 * @returns The file path of the new schema version
 * @throws Error if schema or model not found
 */
export async function deleteModelFromSchema(
  schemaName: string,
  modelName: string,
  options: DeleteOptions = {},
): Promise<string> {
  const { removeReferencingProperties = false } = options

  // Get the latest version
  const latestVersion = await getLatestSchemaVersion(schemaName)
  if (latestVersion === 0) {
    throw new Error(`Schema ${schemaName} not found`)
  }

  // Load the latest schema file
  const latestFilePath = getSchemaFilePath(schemaName, latestVersion)
  const content = await BaseFileManager.readFileAsString(latestFilePath)
  const schemaFile = JSON.parse(content) as SchemaFileFormat

  if (!schemaFile.$schema) {
    throw new Error(`Schema file ${latestFilePath} is not a complete schema file`)
  }

  if (!schemaFile.models[modelName]) {
    throw new Error(`Model ${modelName} not found in schema ${schemaName}`)
  }

  // Check if this is the only model
  if (Object.keys(schemaFile.models).length === 1) {
    throw new Error(`Cannot delete the only model in schema ${schemaName}. A schema must have at least one model.`)
  }

  // Create new version without the model
  // Preserve IDs for remaining models and properties
  const newVersion = latestVersion + 1
  const updatedSchema: SchemaFileFormat = {
    ...schemaFile,
    version: newVersion,
    id: schemaFile.id, // Preserve schema ID
    metadata: {
      ...schemaFile.metadata,
      updatedAt: new Date().toISOString(),
    },
    // Preserve IDs for remaining models and their properties
    models: Object.fromEntries(
      Object.entries(schemaFile.models)
        .filter(([name]) => name !== modelName)
        .map(([name, model]) => [
          name,
          {
            ...model,
            id: model.id, // Preserve model ID
            properties: Object.fromEntries(
              Object.entries(model.properties).map(([propName, prop]) => [
                propName,
                { ...prop, id: prop.id }, // Preserve property ID
              ]),
            ),
          },
        ]),
    ),
    migrations: [
      ...schemaFile.migrations,
      {
        version: newVersion,
        timestamp: new Date().toISOString(),
        description: `Deleted model ${modelName} from schema`,
        changes: [
          {
            type: 'model_delete',
            modelName,
            removeReferencingProperties,
          },
        ],
      },
    ],
  }

  // Remove the model
  delete updatedSchema.models[modelName]

  // Handle properties that reference this model
  const propertiesToRemove: Array<{ modelName: string; propertyName: string }> = []
  
  for (const [otherModelName, model] of Object.entries(updatedSchema.models)) {
    for (const [propertyName, property] of Object.entries(model.properties)) {
      // Check if property references the deleted model
      if (property.model === modelName || property.items?.model === modelName) {
        if (removeReferencingProperties) {
          // Mark for removal
          propertiesToRemove.push({ modelName: otherModelName, propertyName })
        } else {
          // Remove the reference (set to null or remove model field)
          if (property.model === modelName) {
            delete property.model
          }
          if (property.items?.model === modelName) {
            delete property.items.model
            // If items only had model, we might want to remove items entirely
            // But for now, just remove the model reference
          }
        }
      }
    }
  }

  // Remove properties if requested
  if (removeReferencingProperties) {
    for (const { modelName: mName, propertyName } of propertiesToRemove) {
      delete updatedSchema.models[mName].properties[propertyName]
      updatedSchema.migrations[updatedSchema.migrations.length - 1].changes.push({
        type: 'property_delete',
        modelName: mName,
        propertyName,
        reason: `Referenced deleted model ${modelName}`,
      })
    }
  } else {
    // Update migration to note which properties were updated
    const updatedProperties: Array<{ modelName: string; propertyName: string }> = []
    for (const [otherModelName, model] of Object.entries(updatedSchema.models)) {
      for (const [propertyName, property] of Object.entries(model.properties)) {
        if (property.model === modelName || property.items?.model === modelName) {
          updatedProperties.push({ modelName: otherModelName, propertyName })
        }
      }
    }
    if (updatedProperties.length > 0) {
      updatedSchema.migrations[updatedSchema.migrations.length - 1].changes.push({
        type: 'properties_updated',
        properties: updatedProperties,
        reason: `Removed references to deleted model ${modelName}`,
      })
    }
  }

  // Write the new schema version
  const newFilePath = getSchemaFilePath(schemaName, newVersion)
  const newContent = JSON.stringify(updatedSchema, null, 2)
  
  // Ensure the directory exists before saving
  const path = BaseFileManager.getPathModule()
  const dir = path.dirname(newFilePath)
  await BaseFileManager.createDirIfNotExists(dir)
  
  await BaseFileManager.saveFile(newFilePath, newContent)

  // Wait for the file to be available with content (important for browser/OPFS where writes may not be immediately readable)
  await BaseFileManager.waitForFileWithContent(newFilePath)

  logger(`Deleted model ${modelName} from schema ${schemaName} v${newVersion}`)

  // Use dynamic import to break circular dependency
  const { loadSchemaFromFile } = await import('@/imports/json')
  
  // Load the new schema file
  await loadSchemaFromFile(newFilePath)

  return newFilePath
}

/**
 * Delete a property from a model in a schema
 * @param schemaName - The name of the schema
 * @param modelName - The name of the model
 * @param propertyName - The name of the property to delete
 * @param options - Optional deletion options
 * @returns The file path of the new schema version
 * @throws Error if schema, model, or property not found
 */
export async function deletePropertyFromModel(
  schemaName: string,
  modelName: string,
  propertyName: string,
  options: DeleteOptions = {},
): Promise<string> {
  // Get the latest version
  const latestVersion = await getLatestSchemaVersion(schemaName)
  if (latestVersion === 0) {
    throw new Error(`Schema ${schemaName} not found`)
  }

  // Load the latest schema file
  const latestFilePath = getSchemaFilePath(schemaName, latestVersion)
  const content = await BaseFileManager.readFileAsString(latestFilePath)
  const schemaFile = JSON.parse(content) as SchemaFileFormat

  if (!schemaFile.$schema) {
    throw new Error(`Schema file ${latestFilePath} is not a complete schema file`)
  }

  const model = schemaFile.models[modelName]
  if (!model) {
    throw new Error(`Model ${modelName} not found in schema ${schemaName}`)
  }

  if (!model.properties[propertyName]) {
    throw new Error(
      `Property ${propertyName} not found in model ${modelName} of schema ${schemaName}`,
    )
  }

  // Create new version without the property
  // Preserve IDs for schema, models, and remaining properties
  const newVersion = latestVersion + 1
  const updatedSchema: SchemaFileFormat = {
    ...schemaFile,
    version: newVersion,
    id: schemaFile.id, // Preserve schema ID
    metadata: {
      ...schemaFile.metadata,
      updatedAt: new Date().toISOString(),
    },
    models: Object.fromEntries(
      Object.entries(schemaFile.models).map(([mName, m]) => [
        mName,
        {
          ...m,
          id: m.id, // Preserve model ID
          properties: Object.fromEntries(
            Object.entries(m.properties)
              .filter(([propName]) => !(mName === modelName && propName === propertyName))
              .map(([propName, prop]) => [
                propName,
                { ...prop, id: prop.id }, // Preserve property ID
              ]),
          ),
        },
      ]),
    ),
    migrations: [
      ...schemaFile.migrations,
      {
        version: newVersion,
        timestamp: new Date().toISOString(),
        description: `Deleted property ${modelName}.${propertyName} from schema`,
        changes: [
          {
            type: 'property_delete',
            modelName,
            propertyName,
          },
        ],
      },
    ],
  }

  // Write the new schema version
  const newFilePath = getSchemaFilePath(schemaName, newVersion)
  const newContent = JSON.stringify(updatedSchema, null, 2)
  
  // Ensure the directory exists before saving
  const path = BaseFileManager.getPathModule()
  const dir = path.dirname(newFilePath)
  await BaseFileManager.createDirIfNotExists(dir)
  
  await BaseFileManager.saveFile(newFilePath, newContent)

  // Wait for the file to be available with content (important for browser/OPFS where writes may not be immediately readable)
  await BaseFileManager.waitForFileWithContent(newFilePath)

  logger(`Deleted property ${propertyName} from model ${modelName} in schema ${schemaName} v${newVersion}`)

  // Use dynamic import to break circular dependency
  const { loadSchemaFromFile } = await import('@/imports/json')
  
  // Load the new schema file
  await loadSchemaFromFile(newFilePath)

  return newFilePath
}
