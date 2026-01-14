import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:createPropertyInstances')

export type CreatePropertyInstancesInput = {
  propertyIds: string[]  // Array of property file IDs
  modelIds: string[]  // Array of model file IDs (needed to get Model instances)
}

/**
 * Create ModelProperty instances for all property IDs to ensure they're cached
 * Properties are typically created when Model instances are created, but this
 * ensures they're all available in the cache
 */
export const createPropertyInstances = fromCallback<
  EventObject,
  CreatePropertyInstancesInput
>(({ sendBack, input }) => {
  const _create = async (): Promise<void> => {
    const { propertyIds, modelIds } = input
    
    if (propertyIds.length === 0) {
      logger('No property IDs provided, skipping instance creation')
      sendBack({
        type: 'instancesCreated',
        count: 0,
      })
      return
    }

    try {
      const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
      const { Model } = await import('@/Model/Model')
      
      // Properties are typically loaded when Model instances are loaded
      // But we can verify they exist by checking Model instances
      let successCount = 0
      
      // For each model, check if properties are loaded
      for (const modelFileId of modelIds) {
        const model = Model.getById(modelFileId)
        if (model && model.properties) {
          // Count properties that match our property IDs
          for (const prop of model.properties) {
            const context = prop._getSnapshotContext()
            const propFileId = (context as any)._propertyFileId || context.id
            if (propFileId && propertyIds.includes(String(propFileId))) {
              successCount++
            }
          }
        }
      }
      
      // Also try to get properties directly by ID
      for (const propertyFileId of propertyIds) {
        try {
          const property = ModelProperty.getById(propertyFileId)
          if (property) {
            // Check if we already counted this
            const context = property._getSnapshotContext()
            const propFileId = (context as any)._propertyFileId || context.id
            if (!propertyIds.slice(0, propertyIds.indexOf(propertyFileId)).includes(String(propFileId))) {
              successCount++
            }
            logger(`Found/cached ModelProperty instance for propertyFileId "${propertyFileId}"`)
          }
        } catch (error) {
          logger(`Error getting ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
        }
      }
      
      logger(`Finished verifying/caching ${successCount}/${propertyIds.length} Property instances`)
      
      sendBack({
        type: 'instancesCreated',
        count: successCount,
      })
    } catch (error) {
      logger(`Error in createPropertyInstances: ${error}`)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _create().catch((error) => {
    logger('Error in createPropertyInstances:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
