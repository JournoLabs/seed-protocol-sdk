import { EventObject, fromCallback } from 'xstate'
import { SchemaFileFormat, type JsonImportSchema } from '@/types/import'
import { generateId } from '@/helpers'
import { addModelsToDb } from '@/helpers/db'
import debug from 'debug'
import { isInternalSchema, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'
import { BaseDb } from '@/db/Db/BaseDb'

const logger = debug('seedSdk:schema:actors:writeModelsToDb')

export type WriteModelsToDbInput = {
  schema: SchemaFileFormat
  schemaRecord: any  // Schema database record
  schemaName: string
}

export const writeModelsToDb = fromCallback<
  EventObject,
  WriteModelsToDbInput
>(({ sendBack, input }) => {
  const _write = async (): Promise<void> => {
    const { schema, schemaRecord, schemaName } = input
    
    try {
      // Check if models already exist in database
      const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
      const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
      const { eq } = await import('drizzle-orm')
      
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

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
      const expectedModelNames = Object.keys(schema.models || {})
      const linkedModelNames = modelLinks
        .map((link: { modelId: number | null; modelName: string | null }) => link.modelName)
        .filter((n: string | null): n is string => n !== null)
      const missingModels = expectedModelNames.filter(name => !linkedModelNames.includes(name))

      // If all models exist, skip writing
      if (missingModels.length === 0 && modelLinks.length > 0) {
        logger(`All models already exist in database for schema ${schemaName}`)
        
        // Extract model IDs from database
        const modelFileIds: string[] = []
        for (const link of modelLinks) {
          if (link.modelId) {
            const modelRecord = await db
              .select({ schemaFileId: modelsTable.schemaFileId })
              .from(modelsTable)
              .where(eq(modelsTable.id, link.modelId))
              .limit(1)
            
            if (modelRecord.length > 0 && modelRecord[0].schemaFileId) {
              modelFileIds.push(modelRecord[0].schemaFileId)
            }
          }
        }
        
        sendBack({
          type: 'modelsWritten',
          modelIds: modelFileIds,
        })
        return
      }

      // Convert SchemaFileFormat to JsonImportSchema format
      const { createModelsFromJson } = await import('@/imports/json')
      
      // Check if this is Seed Protocol schema (has different format) — use static import so consumer bundles resolve correctly
      const isInternal = isInternalSchema(schemaName)
      
      let importData: JsonImportSchema
      
      if (isInternal && schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
        // Convert Seed Protocol schema format to JSON import format
        importData = {
          name: schemaName,
          models: Object.fromEntries(
            Object.entries(schema.models || {}).map(([modelName, model]) => [
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
                    
                    // Handle List type
                    if (schemaProp.dataType === 'List' && schemaProp.refValueType) {
                      jsonProp.items = {
                        type: schemaProp.refValueType,
                        model: schemaProp.refModelName || schemaProp.ref,
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
          ) as unknown as JsonImportSchema['models'],
        }
      } else {
        // Standard schema format
        importData = {
          name: schemaName,
          models: Object.fromEntries(
            Object.entries(schema.models || {}).map(([modelName, model]) => [
              modelName,
              {
                ...model,
                id: undefined,
                properties: model.properties || {},
              },
            ]),
          ) as unknown as JsonImportSchema['models'],
        }
      }

      // Generate schemaFileIds from JSON file and generate missing ones BEFORE creating models
      const modelFileIds = new Map<string, string>()
      const propertyFileIds = new Map<string, Map<string, string>>()
      
      for (const [modelName, model] of Object.entries(schema.models || {})) {
        // Generate model ID if missing
        if (!model.id) {
          model.id = generateId()
          logger(`Generated model ID for ${modelName}: ${model.id}`)
        }
        modelFileIds.set(modelName, model.id)
        
        const propIds = new Map<string, string>()
        for (const [propName, prop] of Object.entries(model.properties || {})) {
          // Generate property ID if missing
          if (!prop.id) {
            prop.id = generateId()
            logger(`Generated property ID for ${modelName}.${propName}: ${prop.id}`)
          }
          propIds.set(propName, prop.id)
        }
        if (propIds.size > 0) {
          propertyFileIds.set(modelName, propIds)
        }
      }

      // Convert JSON models to Model classes
      const modelDefinitions = await createModelsFromJson(importData, modelFileIds, propertyFileIds)
      
      // Add models to database
      if (Object.keys(modelDefinitions).length > 0) {
        await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
          schemaFileId: schema.id,
          modelFileIds,
          propertyFileIds,
        })
        logger(`Added ${Object.keys(modelDefinitions).length} models and their properties to database`)
      }

      // Extract model IDs that were written
      const writtenModelIds = Array.from(modelFileIds.values())
      
      sendBack({
        type: 'modelsWritten',
        modelIds: writtenModelIds,
      })
    } catch (error) {
      logger(`Error writing models to database: ${error}`)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _write().catch((error) => {
    logger('Error in writeModelsToDb:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
