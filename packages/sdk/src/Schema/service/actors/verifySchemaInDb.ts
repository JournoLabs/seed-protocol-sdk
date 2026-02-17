import { EventObject, fromCallback } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:verifySchemaInDb')

export type VerifySchemaInDbInput = {
  schemaFileId: string
  expectedSchemaId?: number
}

/**
 * Verify that a schema record exists in the database with retry logic
 * Uses exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms
 * Total timeout: ~3.1 seconds
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

export const verifySchemaInDb = fromCallback<
  EventObject,
  VerifySchemaInDbInput
>(({ sendBack, input }) => {
  const _verify = async (): Promise<void> => {
    const { schemaFileId, expectedSchemaId } = input
    
    try {
      const result = await verifyWithRetry(async () => {
        const db = BaseDb.getAppDb()
        if (!db) {
          throw new Error('Database not available')
        }

        // Query for schema by schemaFileId
        const schemaRecords = await db
          .select()
          .from(schemas)
          .where(eq(schemas.schemaFileId, schemaFileId))
          .limit(1)

        if (schemaRecords.length === 0) {
          throw new Error(`Schema with schemaFileId "${schemaFileId}" not found in database`)
        }

        const schemaRecord = schemaRecords[0]

        // If expectedSchemaId is provided, verify it matches
        if (expectedSchemaId !== undefined && schemaRecord.id !== expectedSchemaId) {
          throw new Error(
            `Schema ID mismatch: expected ${expectedSchemaId}, found ${schemaRecord.id}`
          )
        }

        logger(`Schema verified: schemaFileId="${schemaFileId}", schemaId=${schemaRecord.id}`)
        return schemaRecord.id!
      })

      sendBack({
        type: 'schemaVerified',
        schemaId: result,
      })
    } catch (error) {
      logger(`Schema verification failed after retries: ${error}`)
      sendBack({
        type: 'verificationFailed',
        stage: 'verifySchema',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _verify().catch((error) => {
    logger('Error in verifySchemaInDb:', error)
    sendBack({
      type: 'verificationFailed',
      stage: 'verifySchema',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
