import { EventObject, fromCallback } from 'xstate'
import { SchemaFileFormat, type JsonImportSchema } from '@/types/import'
import { BaseFileManager, generateId } from '@/helpers'
import { addSchemaToDb } from '@/helpers/db'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import { getLatestSchemaVersion } from '@/helpers/schema'
import debug from 'debug'
import { isInternalSchema, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const logger = debug('seedSdk:schema:actors:writeSchemaToDb')

export type WriteSchemaToDbInput = {
  schemaName: string
  schemaFile?: SchemaFileFormat  // Optional: if provided, use this schema
  existingDbSchema?: { version?: number }  // Optional: existing schema for version calculation
}

export const writeSchemaToDb = fromCallback<
  EventObject,
  WriteSchemaToDbInput
>(({ sendBack, input }) => {
  const _write = async (): Promise<void> => {
    const { schemaName, schemaFile, existingDbSchema } = input
    
    try {
      // Check if this is an internal SDK schema (Seed Protocol) — use static import so consumer bundles resolve correctly
      const isInternal = isInternalSchema(schemaName)
      
      let finalSchema: SchemaFileFormat
      let schemaRecord: typeof schemas.$inferSelect

      if (isInternal && schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
        // For Seed Protocol, load from internal file
        logger(`Loading internal Seed Protocol schema from SDK`)
        const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
        finalSchema = internalSchema.default as SchemaFileFormat
        
        const db = BaseDb.getAppDb()
        if (db && finalSchema.id) {
          // Check if it exists in database
          const existing = await db
            .select()
            .from(schemas)
            .where(eq(schemas.schemaFileId, finalSchema.id))
            .limit(1)
          
          if (existing.length === 0) {
            // Add to database if not present
            const schemaData = JSON.stringify(finalSchema, null, 2)
            schemaRecord = await addSchemaToDb(
              {
                name: schemaName,
                version: finalSchema.version,
                createdAt: new Date(finalSchema.metadata.createdAt).getTime(),
                updatedAt: new Date(finalSchema.metadata.updatedAt).getTime(),
              },
              finalSchema.id,
              schemaData,
              false, // isDraft = false (it's a published internal schema)
              false, // isEdited = false (it's a published internal schema)
            )
            logger(`Added Seed Protocol schema to database`)
          } else {
            schemaRecord = existing[0]
            logger(`Seed Protocol schema already exists in database`)
          }
        } else {
          throw new Error('Database not available for Seed Protocol schema')
        }
      } else if (schemaFile) {
        // Use provided schema file
        finalSchema = schemaFile
        
        // Ensure schema has an ID
        if (!finalSchema.id) {
          finalSchema.id = generateId()
          logger(`Generated schema ID for schema: ${finalSchema.id}`)
        }

        const schemaData = JSON.stringify(finalSchema, null, 2)
        schemaRecord = await addSchemaToDb(
          {
            name: schemaName,
            version: finalSchema.version,
            createdAt: new Date(finalSchema.metadata.createdAt).getTime(),
            updatedAt: new Date(finalSchema.metadata.updatedAt).getTime(),
          },
          finalSchema.id,
          schemaData,
          true, // isDraft = true for new schemas
          true, // isEdited = true for runtime-created schemas
        )
        logger(`Created schema ${schemaName} v${finalSchema.version} in database`)
      } else {
        // Create new schema
        const latestVersion = existingDbSchema?.version 
          ? existingDbSchema.version + 1 
          : await getLatestSchemaVersion(schemaName)
        const newVersion = latestVersion + 1

        const now = new Date().toISOString()
        finalSchema = {
          $schema: 'https://seedprotocol.org/schemas/data-model/v1',
          version: newVersion,
          id: generateId(),
          metadata: {
            name: schemaName,
            createdAt: now,
            updatedAt: now,
          },
          models: {},
          enums: {},
          migrations: [
            {
              version: newVersion,
              timestamp: now,
              description: 'Initial schema',
              changes: [],
            },
          ],
        }

        // Save to database as draft
        const schemaData = JSON.stringify(finalSchema, null, 2)
        schemaRecord = await addSchemaToDb(
          {
            name: schemaName,
            version: newVersion,
            createdAt: new Date(now).getTime(),
            updatedAt: new Date(now).getTime(),
          },
          finalSchema.id,
          schemaData,
          true, // isDraft = true
          true, // isEdited = true for runtime-created schemas
        )
        logger(`Created new draft schema ${schemaName} v${newVersion} in database`)
      }

      sendBack({
        type: 'schemaWritten',
        schemaRecord,
        schema: finalSchema,
      })
    } catch (error) {
      logger(`Error writing schema to database: ${error}`)
      sendBack({
        type: 'writeError',
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  _write().catch((error) => {
    logger('Error in writeSchemaToDb:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
