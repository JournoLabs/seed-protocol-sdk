import { applySchemaFile, writeNextSchemaVersion } from '@/helpers/schemaApply'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/Schema'
import { ModelPropertyDataTypes, isDataType } from '@/helpers/property'
import { resolveModelRecord } from '@/db/read/resolveModelRecord'
import debug from 'debug'

const logger = debug('seedSdk:helpers:updateSchema')

// Schema reloads renameModelProperty deferred and that haven't finished yet
const deferredSchemaReloads = new Set<Promise<void>>()

/**
 * Resolves once every schema reload deferred by renameModelProperty has finished (failures are logged,
 * not thrown). For tests and teardown that must not overlap that reload.
 */
export async function whenDeferredSchemaReloadsSettled(): Promise<void> {
  while (deferredSchemaReloads.size > 0) {
    await Promise.all(deferredSchemaReloads)
  }
}

/**
 * Schema property update definition
 */
export type SchemaPropertyUpdate = {
  modelName: string
  propertyName: string
  updates: {
    type?: string
    model?: string
    refValueType?: string
    ref?: string
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
  if (isDataType(property.dataType, ModelPropertyDataTypes.Relation)) {
    if (property.ref) {
      updates.model = property.ref
    } else if (property.refModelId) {
      // If ref is not set but refModelId is, get the model name from the database
      const refModelName = (await resolveModelRecord(undefined, { modelId: property.refModelId }))?.name
      if (refModelName) {
        updates.model = refModelName
      }
    }
  }

  // Handle List type
  if (isDataType(property.dataType, ModelPropertyDataTypes.List)) {
    if (property.refValueType) {
      updates.refValueType = property.refValueType
      if (property.ref) {
        updates.ref = property.ref
      } else if (property.refModelId) {
        // If ref is not set but refModelId is, get the model name from the database
        const refModelName = (await resolveModelRecord(undefined, { modelId: property.refModelId }))?.name
        if (refModelName) {
          updates.ref = refModelName
        }
      }
    }
  }

  // Handle required (validation constraint)
  if (property.required !== undefined) {
    updates.required = property.required
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
  const modelRenames = new Map<string, string>()
  const changes: any[] = propertyUpdates.map((update) => ({
    type: 'property_update',
    modelName: update.modelName,
    propertyName: update.propertyName,
    updates: update.updates,
  }))
  const { filePath } = await writeNextSchemaVersion(
    schemaName,
    (schema) => {
      for (const { oldName, newName } of modelUpdates ?? []) {
        if (!schema.models[oldName]) continue
        schema.models[newName] = schema.models[oldName]
        delete schema.models[oldName]
        // References to the model follow the rename
        for (const model of Object.values(schema.models)) {
          for (const property of Object.values(model.properties)) {
            if (property.model === oldName) property.model = newName
            if (property.ref === oldName) property.ref = newName
            if (property.refModelName === oldName) property.refModelName = newName
            if (property.items?.model === oldName) property.items.model = newName
          }
        }
        modelRenames.set(oldName, newName)
        changes.push({ type: 'model_rename', oldName, newName })
      }

      for (const update of propertyUpdates) {
        const model = schema.models[update.modelName]
        if (!model) {
          throw new Error(`Model ${update.modelName} not found in schema ${schemaName}`)
        }
        const property = model.properties[update.propertyName]
        if (!property) {
          throw new Error(
            `Property ${update.propertyName} not found in model ${update.modelName} of schema ${schemaName}`,
          )
        }
        const { type, ...updates } = update.updates
        // One key per field: a property written with `dataType` takes the new type there
        if (type !== undefined) property[property.dataType !== undefined ? 'dataType' : 'type'] = type
        Object.assign(property, updates)
      }
      return schema
    },
    {
      description: `Updated model properties: ${propertyUpdates.map((u) => `${u.modelName}.${u.propertyName}`).join(', ')}`,
      changes,
      modelRenames,
    },
  )
  return filePath
}

/**
 * Rename a property in a model, keeping its id: writes the next schema version, moves the
 * property's metadata rows to the new name, then applies the version to the rows.
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
  const { schemaFile, filePath } = await writeNextSchemaVersion(
    schemaName,
    (schema) => {
      const model = schema.models[modelName]
      if (!model) {
        throw new Error(`Model ${modelName} not found in schema ${schemaName}`)
      }
      if (!model.properties[oldPropertyName]) {
        throw new Error(`Property ${oldPropertyName} not found in model ${modelName} of schema ${schemaName}`)
      }
      if (model.properties[newPropertyName]) {
        throw new Error(`Property ${newPropertyName} already exists in model ${modelName} of schema ${schemaName}`)
      }
      // Same position, new key
      model.properties = Object.fromEntries(
        Object.entries(model.properties).map(([name, prop]) => [name === oldPropertyName ? newPropertyName : name, prop]),
      )
      return schema
    },
    {
      description: `Renamed property ${modelName}.${oldPropertyName} to ${newPropertyName}`,
      changes: [{ type: 'property_rename', modelName, oldPropertyName, newPropertyName }],
      apply: false,
    },
  )
  logger(`Renamed property ${oldPropertyName} to ${newPropertyName} in schema ${schemaName} v${schemaFile.version}`)

  // Item values follow the property by property_id (decision D4); only pending edits name it
  const { renamePendingWritesForProperty } = await import('./db')
  await renamePendingWritesForProperty(modelName, oldPropertyName, newPropertyName)

  // Applied after a delay: applying posts to BroadcastChannel and causes React invalidates, and
  // running that inside the caller's save flow froze it (updateContext/refetch loops).
  const reload: Promise<void> = new Promise<void>((resolve) => setTimeout(resolve, 100))
    .then(() => applySchemaFile(schemaFile, { store: false }))
    .then(
      () => {},
      (err) => {
        logger('Deferred schema apply after rename failed:', err)
      },
    )
    .finally(() => deferredSchemaReloads.delete(reload))
  deferredSchemaReloads.add(reload)

  return filePath
}
