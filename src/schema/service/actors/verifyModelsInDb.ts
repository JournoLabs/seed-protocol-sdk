import { EventObject, fromCallback } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { modelSchemas, models as modelsTable } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:verifyModelsInDb')

export type VerifyModelsInDbInput = {
  schemaId: number
  expectedModelIds?: string[]  // Optional: verify specific model IDs exist
}

/**
 * Verify that model records exist in the database for a schema with retry logic
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

export const verifyModelsInDb = fromCallback<
  EventObject,
  VerifyModelsInDbInput
>(({ sendBack, input }) => {
  const _verify = async (): Promise<void> => {
    const { schemaId, expectedModelIds } = input
    
    try {
      const result = await verifyWithRetry(async () => {
        const db = BaseDb.getAppDb()
        if (!db) {
          throw new Error('Database not available')
        }

        // Query for models linked to this schema
        const modelRecords = await db
          .select({
            modelFileId: modelsTable.schemaFileId,
            modelId: modelsTable.id,
          })
          .from(modelSchemas)
          .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
          .where(eq(modelSchemas.schemaId, schemaId))

        if (modelRecords.length === 0) {
          throw new Error(`No models found for schema (id: ${schemaId})`)
        }

        const modelIds = modelRecords
          .map((row: { modelFileId: string | null }) => row.modelFileId)
          .filter((id: string | null | undefined): id is string => id !== null && id !== undefined)

        // If expectedModelIds provided, verify all are present
        if (expectedModelIds && expectedModelIds.length > 0) {
          const missingIds = expectedModelIds.filter(id => !modelIds.includes(id))
          if (missingIds.length > 0) {
            throw new Error(
              `Missing expected model IDs: ${missingIds.join(', ')}. Found: ${modelIds.join(', ')}`
            )
          }
        }

        logger(`Models verified: schemaId=${schemaId}, found ${modelIds.length} models: ${modelIds.join(', ')}`)
        return modelIds
      })

      sendBack({
        type: 'modelsVerified',
        modelIds: result,
      })
    } catch (error) {
      logger(`Model verification failed after retries: ${error}`)
      sendBack({
        type: 'verificationFailed',
        stage: 'verifyModels',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _verify().catch((error) => {
    logger('Error in verifyModelsInDb:', error)
    sendBack({
      type: 'verificationFailed',
      stage: 'verifyModels',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
