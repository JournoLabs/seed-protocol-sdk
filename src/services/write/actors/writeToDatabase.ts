import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:write:writeToDatabase')

type WriteToDatabaseInput = {
  entityType: 'model' | 'modelProperty' | 'schema'
  entityId: string
  entityData: any
}

export const writeToDatabase = fromCallback<
  EventObject,
  WriteToDatabaseInput
>(({ sendBack, input }) => {
  const _write = async (): Promise<void> => {
    try {
      const { BaseDb } = await import('@/db/Db/BaseDb')
      const db = BaseDb.getAppDb()
      
      if (!db) {
        throw new Error('Database not available')
      }

      let output: any = input.entityData

      if (input.entityType === 'model') {
        const { writeModelToDb } = await import('@/helpers/db')
        const { BaseDb } = await import('@/db/Db/BaseDb')
        const { models: modelsTable } = await import('@/seedSchema/ModelSchema')
        const { eq } = await import('drizzle-orm')
        const writeMsg = `Writing model to database: ${input.entityData.modelName} (schemaId: ${input.entityData.schemaId})`
        logger(writeMsg)
        console.log(writeMsg) // Always log to console
        logger(`Writing model to database:`, {
          modelFileId: input.entityId,
          modelName: input.entityData.modelName,
          schemaId: input.entityData.schemaId,
        })
        await writeModelToDb(input.entityId, input.entityData)
        
        // Get modelId from database after write
        const db = BaseDb.getAppDb()
        if (db) {
          const modelRecords = await db
            .select({ id: modelsTable.id })
            .from(modelsTable)
            .where(eq(modelsTable.schemaFileId, input.entityId))
            .limit(1)
          
          if (modelRecords.length > 0 && modelRecords[0].id) {
            output = { ...input.entityData, id: modelRecords[0].id }
          } else {
            output = input.entityData
          }
        } else {
          output = input.entityData
        }
        
        const successMsg = `Successfully wrote model "${input.entityData.modelName}" to database`
        logger(successMsg)
        console.log(successMsg) // Always log to console
      } else if (input.entityType === 'modelProperty') {
        const { writePropertyToDb } = await import('@/helpers/db')
        await writePropertyToDb(input.entityId, input.entityData)
        output = input.entityData
      } else if (input.entityType === 'schema') {
        const { addSchemaToDb } = await import('@/helpers/db')
        const schemaRecord = await addSchemaToDb(
          input.entityData,
          input.entityId, // schemaFileId
          input.entityData.schemaData,
          input.entityData.isDraft
        )
        output = { ...input.entityData, id: schemaRecord.id }
      } else {
        throw new Error(`Unknown entity type: ${input.entityType}`)
      }

      // Send success event explicitly - callback actors don't trigger onDone
      sendBack({
        type: 'writeSuccess',
        output,
      })
    } catch (error) {
      logger('Error in writeToDatabase:', error)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _write().catch((error) => {
    logger('Error in writeToDatabase promise:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})

