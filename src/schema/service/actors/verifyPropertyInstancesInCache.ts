import { EventObject, fromCallback } from 'xstate'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:verifyPropertyInstancesInCache')

export type VerifyPropertyInstancesInCacheInput = {
  propertyIds: string[]  // Array of property file IDs
}

/**
 * Verify that ModelProperty instances exist in the static cache with retry logic
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

export const verifyPropertyInstancesInCache = fromCallback<
  EventObject,
  VerifyPropertyInstancesInCacheInput
>(({ sendBack, input }) => {
  const _verify = async (): Promise<void> => {
    const { propertyIds } = input
    
    if (propertyIds.length === 0) {
      // No properties means no instances to verify - this is valid
      logger('No property IDs provided, skipping instance verification')
      sendBack({
        type: 'instancesVerified',
        count: 0,
      })
      return
    }

    try {
      const result = await verifyWithRetry(async () => {
        const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
        
        // Check each property ID in the cache
        const verifiedInstances: string[] = []
        const missingIds: string[] = []

        for (const propertyFileId of propertyIds) {
          // Try to get instance from cache
          const instance = ModelProperty.getById(propertyFileId)
          if (instance) {
            verifiedInstances.push(propertyFileId)
          } else {
            missingIds.push(propertyFileId)
          }
        }

        if (missingIds.length > 0) {
          throw new Error(
            `Property instances not found in cache: ${missingIds.join(', ')}. Found: ${verifiedInstances.length}/${propertyIds.length}`
          )
        }

        logger(`Property instances verified: ${verifiedInstances.length} instances in cache`)
        return verifiedInstances.length
      })

      sendBack({
        type: 'instancesVerified',
        count: result,
      })
    } catch (error) {
      logger(`Property instance verification failed after retries: ${error}`)
      sendBack({
        type: 'verificationFailed',
        stage: 'verifyPropertyInstances',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _verify().catch((error) => {
    logger('Error in verifyPropertyInstancesInCache:', error)
    sendBack({
      type: 'verificationFailed',
      stage: 'verifyPropertyInstances',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
