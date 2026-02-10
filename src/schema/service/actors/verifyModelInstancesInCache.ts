import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:verifyModelInstancesInCache')

export type VerifyModelInstancesInCacheInput = {
  modelIds: string[]  // Array of model file IDs
}

/**
 * Verify that Model instances exist in the static cache with retry logic
 */
async function verifyWithRetry<T>(
  verifyFn: () => Promise<T>,
  maxRetries: number = 5,
  initialDelay: number = 100
): Promise<T> {
  let lastError: Error | null = null
  let delay = initialDelay
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await verifyFn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < maxRetries - 1) {
        logger(`Verification attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= 2  // Exponential backoff
      }
    }
  }
  
  throw lastError || new Error('Verification failed after retries')
}

export const verifyModelInstancesInCache = fromCallback<
  EventObject,
  VerifyModelInstancesInCacheInput
>(({ sendBack, input }) => {
  const _verify = async (): Promise<void> => {
    const { modelIds } = input
    
    if (modelIds.length === 0) {
      // No models means no instances to verify - this is valid
      logger('No model IDs provided, skipping instance verification')
      sendBack({
        type: 'instancesVerified',
        count: 0,
      })
      return
    }

    try {
      const result = await verifyWithRetry(async () => {
        const { Model } = await import('../../../Model/Model')
        
        // Check each model ID in the cache
        const verifiedInstances: string[] = []
        const missingIds: string[] = []

        for (const modelFileId of modelIds) {
          // Try to get instance from cache
          const instance = Model.getById(modelFileId)
          if (instance) {
            verifiedInstances.push(modelFileId)
          } else {
            missingIds.push(modelFileId)
          }
        }

        if (missingIds.length > 0) {
          throw new Error(
            `Model instances not found in cache: ${missingIds.join(', ')}. Found: ${verifiedInstances.length}/${modelIds.length}`
          )
        }

        logger(`Model instances verified: ${verifiedInstances.length} instances in cache`)
        return verifiedInstances.length
      })

      sendBack({
        type: 'instancesVerified',
        count: result,
      })
    } catch (error) {
      logger(`Model instance verification failed after retries: ${error}`)
      sendBack({
        type: 'verificationFailed',
        stage: 'verifyModelInstances',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _verify().catch((error) => {
    logger('Error in verifyModelInstancesInCache:', error)
    sendBack({
      type: 'verificationFailed',
      stage: 'verifyModelInstances',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
