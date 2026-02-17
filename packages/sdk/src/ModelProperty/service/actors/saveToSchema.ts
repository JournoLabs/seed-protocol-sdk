import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelPropertyMachineContext } from '../modelPropertyMachine'
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

    // Persist to database only - schema file is updated only when user calls Schema.saveNewVersion()
    const dbMod = await import('../../../helpers/db')
    const { savePropertyToDb } = dbMod
    await savePropertyToDb(context)

    // Mark schema as draft so user knows to save
    const schemaName = context._schemaName ?? (await getSchemaNameFromModel(context.modelName))
    if (schemaName) {
      const schemaMod = await import('../../../Schema/Schema')
      const { Schema } = schemaMod
      const schema = Schema.create(schemaName, { waitForReady: false }) as import('@/Schema/Schema').Schema
      schema.getService().send({
        type: 'markAsDraft',
        propertyKey: `${context.modelName}:${context.name}`,
      })
    }

    logger(`Successfully saved property ${context.modelName}:${context.name} to database`)
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
