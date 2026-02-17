import { EventObject, fromCallback } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:verifyPropertiesInDb')

export type VerifyPropertiesInDbInput = {
  modelIds?: number[]  // Array of model DB IDs (preferred)
  modelFileIds?: string[]  // Array of model file IDs (alternative)
  expectedPropertyIds?: string[]  // Optional: verify specific property IDs exist
}

/**
 * Verify that property records exist in the database for models with retry logic
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

export const verifyPropertiesInDb = fromCallback<
  EventObject,
  VerifyPropertiesInDbInput
>(({ sendBack, input }) => {
  const _verify = async (): Promise<void> => {
    const { modelIds, modelFileIds, expectedPropertyIds } = input
    
    // Convert model file IDs to DB IDs if needed
    let dbModelIds: number[] = []
    
    if (modelIds && modelIds.length > 0) {
      dbModelIds = modelIds
    } else if (modelFileIds && modelFileIds.length > 0) {
      // Convert file IDs to DB IDs
      const db = BaseDb.getAppDb()
      if (!db) {
        throw new Error('Database not available')
      }
      
      for (const modelFileId of modelFileIds) {
        const modelRecords = await db
          .select({ id: modelsTable.id })
          .from(modelsTable)
          .where(eq(modelsTable.schemaFileId, modelFileId))
          .limit(1)
        
        if (modelRecords.length > 0 && modelRecords[0].id) {
          dbModelIds.push(modelRecords[0].id)
        }
      }
    }
    
    if (dbModelIds.length === 0) {
      // No models means no properties to verify - this is valid
      logger('No models provided, skipping property verification')
      sendBack({
        type: 'propertiesVerified',
        propertyIds: [],
      })
      return
    }

    try {
      const result = await verifyWithRetry(async () => {
        const db = BaseDb.getAppDb()
        if (!db) {
          throw new Error('Database not available')
        }

        // Query for properties for all models
        const allProperties = await Promise.all(
          dbModelIds.map(async (modelId) => {
            const props = await db
              .select({
                propertyFileId: propertiesTable.schemaFileId,
                propertyId: propertiesTable.id,
              })
              .from(propertiesTable)
              .where(eq(propertiesTable.modelId, modelId))
            return props
          })
        )

        const propertyIds = allProperties
          .flat()
          .map((row: { propertyFileId: string | null }) => row.propertyFileId)
          .filter((id: string | null | undefined): id is string => id !== null && id !== undefined)

        // If expectedPropertyIds provided, verify all are present
        if (expectedPropertyIds && expectedPropertyIds.length > 0) {
          const missingIds = expectedPropertyIds.filter(id => !propertyIds.includes(id))
          if (missingIds.length > 0) {
            throw new Error(
              `Missing expected property IDs: ${missingIds.join(', ')}. Found: ${propertyIds.join(', ')}`
            )
          }
        }

        logger(`Properties verified: found ${propertyIds.length} properties for ${dbModelIds.length} models`)
        return propertyIds
      })

      sendBack({
        type: 'propertiesVerified',
        propertyIds: result,
      })
    } catch (error) {
      logger(`Property verification failed after retries: ${error}`)
      sendBack({
        type: 'verificationFailed',
        stage: 'verifyProperties',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _verify().catch((error) => {
    logger('Error in verifyPropertiesInDb:', error)
    sendBack({
      type: 'verificationFailed',
      stage: 'verifyProperties',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
