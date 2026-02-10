import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:createModelInstances')

export type CreateModelInstancesInput = {
  modelIds: string[]  // Array of model file IDs
  schemaName: string
}

/**
 * Create Model instances for all model IDs to ensure they're cached
 * This ensures that Model.getById() in Schema.getContext() will find the instances
 */
export const createModelInstances = fromCallback<
  EventObject,
  CreateModelInstancesInput
>(({ sendBack, input }) => {
  const _create = async (): Promise<void> => {
    const { modelIds, schemaName } = input
    
    if (modelIds.length === 0) {
      logger('No model IDs provided, skipping instance creation')
      sendBack({
        type: 'instancesCreated',
        count: 0,
      })
      return
    }

    try {
      const { Model } = await import('../../../Model/Model')
      
      // Create instances for all model IDs in parallel
      // Model.createById() will check cache first, then query DB and create if needed
      const createPromises = modelIds.map(async (modelFileId) => {
        try {
          const model = await Model.createById(modelFileId)
          if (model) {
            logger(`Created/cached Model instance for modelFileId "${modelFileId}"`)
            return true
          } else {
            logger(`Model.createById returned undefined for modelFileId "${modelFileId}" (may not exist in DB yet)`)
            return false
          }
        } catch (error) {
          logger(`Error creating Model instance for modelFileId "${modelFileId}": ${error}`)
          // Don't throw - continue with other models
          return false
        }
      })
      
      const results = await Promise.all(createPromises)
      const successCount = results.filter(Boolean).length
      
      logger(`Finished creating/caching ${successCount}/${modelIds.length} Model instances`)
      
      sendBack({
        type: 'instancesCreated',
        count: successCount,
      })
    } catch (error) {
      logger(`Error in createModelInstances: ${error}`)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _create().catch((error) => {
    logger('Error in createModelInstances:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
