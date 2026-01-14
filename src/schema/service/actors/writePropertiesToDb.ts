import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:writePropertiesToDb')

export type WritePropertiesToDbInput = {
  // Properties are written as part of writeModelsToDb
  // This actor is mainly for verification/consistency
  // In most cases, properties are already written with models
  modelIds: string[]  // Model file IDs to get property IDs from
}

/**
 * Properties are typically written to DB as part of writeModelsToDb
 * This actor verifies that properties exist and extracts their IDs
 */
export const writePropertiesToDb = fromCallback<
  EventObject,
  WritePropertiesToDbInput
>(({ sendBack, input }) => {
  const _write = async (): Promise<void> => {
    const { modelIds } = input
    
    try {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const { models: modelsTable, properties: propertiesTable } = await import('@/seedSchema/ModelSchema')
      const { eq } = await import('drizzle-orm')
      
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }

      // Get property IDs for all models
      const propertyIds: string[] = []
      
      for (const modelFileId of modelIds) {
        // Get model DB ID from modelFileId
        const modelRecords = await db
          .select({ id: modelsTable.id })
          .from(modelsTable)
          .where(eq(modelsTable.schemaFileId, modelFileId))
          .limit(1)
        
        if (modelRecords.length > 0 && modelRecords[0].id) {
          // Get properties for this model
          const propertyRecords = await db
            .select({ schemaFileId: propertiesTable.schemaFileId })
            .from(propertiesTable)
            .where(eq(propertiesTable.modelId, modelRecords[0].id))
          
          for (const prop of propertyRecords) {
            if (prop.schemaFileId) {
              propertyIds.push(prop.schemaFileId)
            }
          }
        }
      }
      
      logger(`Found ${propertyIds.length} properties for ${modelIds.length} models`)
      
      sendBack({
        type: 'propertiesWritten',
        propertyIds,
      })
    } catch (error) {
      logger(`Error writing/verifying properties to database: ${error}`)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _write().catch((error) => {
    logger('Error in writePropertiesToDb:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
