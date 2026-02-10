import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelPropertyMachineContext } from '../modelPropertyMachine'
import { convertPropertyToSchemaUpdate, updateModelProperties, getModelNameFromId } from '@/helpers/updateSchema'
// Dynamic import to break circular dependency: schema/index -> ... -> saveToSchema -> SchemaValidationService -> schema/index
// import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { BaseDb } from '@/db/Db/BaseDb'
import debug from 'debug'

const logger = debug('seedSdk:modelProperty:actors:saveToSchema')

/**
 * Get schema name from model
 * This function finds which schema contains the given model
 * Exported so it can be reused by ModelProperty for setting schema name
 */
export async function getSchemaNameFromModel(modelName: string): Promise<string | undefined> {
  // Get the latest schema files and find which one contains this model
  const schemaHelpersMod = await import('../../../helpers/schema')
  const { listLatestSchemaFiles } = schemaHelpersMod
  const latestSchemas = await listLatestSchemaFiles()

  for (const schema of latestSchemas) {
    try {
      const fileManagerMod = await import('../../../helpers/FileManager/BaseFileManager')
      const { BaseFileManager } = fileManagerMod
      const content = await BaseFileManager.readFileAsString(schema.filePath)
      const schemaFile = JSON.parse(content) as any

      if (schemaFile.models && schemaFile.models[modelName]) {
        return schema.name
      }
    } catch (error) {
      logger('Error reading schema file:', error)
      continue
    }
  }

  return undefined
}

export const saveToSchema = fromCallback<
  EventObject,
  FromCallbackInput<ModelPropertyMachineContext>
>(({ sendBack, input: { context } }) => {
  const _saveToSchema = async (): Promise<void> => {
    // Use dynamic import to break circular dependency
    const validationServiceMod = await import('../../../Schema/service/validation/SchemaValidationService')
    const { SchemaValidationService } = validationServiceMod
    const validationService = new SchemaValidationService()
    
    // Validate property structure before saving
    const validationResult = validationService.validatePropertyStructure(context)
    if (!validationResult.isValid) {
      throw new Error(`Property validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`)
    }

    // Validate required fields
    if (!context.name) {
      throw new Error('Property name is required')
    }

    if (!context.dataType) {
      throw new Error('Data type is required')
    }

    if (!context.modelName) {
      throw new Error(`Model not found for modelId: ${context.modelId}`)
    }

    // Get schema name from model
    const schemaName = await getSchemaNameFromModel(context.modelName)
    if (!schemaName) {
      throw new Error(`Schema not found for model: ${context.modelName}`)
    }

    // Convert property context to SchemaPropertyUpdate
    const propertyUpdate = await convertPropertyToSchemaUpdate(
      context,
      context.modelName,
      context.name,
    )

    // Update the schema with the property changes
    await updateModelProperties(schemaName, [propertyUpdate])

    // Clear isEdited flag in database after saving to schema file
    try {
      const seedSchemaMod = await import('../../../seedSchema')
      const { properties: propertiesTable, models: modelsTable } = seedSchemaMod
      const drizzleMod = await import('drizzle-orm')
      const { eq, and } = drizzleMod
      
      const db = BaseDb.getAppDb()
      if (db && context.modelName && context.name) {
        // Find model by name
        const modelRecords = await db
          .select({ id: modelsTable.id })
          .from(modelsTable)
          .where(eq(modelsTable.name, context.modelName))
          .limit(1)
        
        if (modelRecords.length > 0) {
          // Find property by name and modelId
          const propertyRecords = await db
            .select({ id: propertiesTable.id })
            .from(propertiesTable)
            .where(
              and(
                eq(propertiesTable.name, context.name),
                eq(propertiesTable.modelId, modelRecords[0].id)
              )
            )
            .limit(1)
          
          if (propertyRecords.length > 0) {
            // Clear isEdited flag in database
            await db
              .update(propertiesTable)
              .set({ isEdited: false })
              .where(eq(propertiesTable.id, propertyRecords[0].id!))
            logger(`Cleared isEdited flag in database for property ${context.modelName}:${context.name}`)
          }
        }
      }
    } catch (error) {
      logger(`Error clearing isEdited flag in database: ${error}`)
    }

    logger(`Successfully saved property ${context.name} to schema ${schemaName}`)
  }

  _saveToSchema().then(() => {
    sendBack({ type: 'saveToSchemaSuccess' })
  }).catch((error) => {
    logger('Error saving to schema:', error)
    sendBack({ type: 'saveToSchemaError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})
