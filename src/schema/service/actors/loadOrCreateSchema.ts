import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { getLatestSchemaVersion, listCompleteSchemaFiles } from '@/helpers/schema'
import { SchemaFileFormat } from '@/types/import'
import { BaseFileManager, generateId, } from '@/helpers'
import { addSchemaToDb } from '@/helpers/db'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq, and, desc } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:loadOrCreateSchema')

/**
 * Generate filename for a schema based on name and version
 * Format: {name}-v{version}.json
 */
const getSchemaFilename = (name: string, version: number): string => {
  // Sanitize name to be filesystem-safe
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${sanitizedName}-v${version}.json`
}

/**
 * Get the full file path for a schema
 */
const getSchemaFilePath = (name: string, version: number): string => {
  const path = BaseFileManager.getPathModule()
  const filename = getSchemaFilename(name, version)
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, filename)
}

export const loadOrCreateSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateSchema = async (): Promise<void> => {
    const { schemaName } = context

    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not found')
    }

    // STEP 1: Query database first for existing schema (prefer drafts)
    const dbSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, schemaName))
      .orderBy(desc(schemas.isDraft), desc(schemas.version))
      .limit(1)

    if (dbSchemas.length > 0) {
      const dbSchema = dbSchemas[0]

      // If it's a draft, load from schemaData
      if (dbSchema.isDraft === true && dbSchema.schemaData) {
        try {
          const schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
          logger(`Found draft schema ${schemaName} v${schemaFile.version} in database`)
          
          // Ensure models are populated (fallback for seed-protocol if missing)
          if ((!schemaFile.models || Object.keys(schemaFile.models).length === 0) && schemaName === 'Seed Protocol') {
            try {
              const internalSchema = await import('@/seedSchema/seed-protocol-v1.json')
              const internalSchemaFile = internalSchema.default as SchemaFileFormat
              schemaFile.models = internalSchemaFile.models
              logger(`Populated models for seed-protocol schema from internal file`)
            } catch (error) {
              logger(`Error loading internal seed-protocol schema for models:`, error)
            }
          }
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
          })
          return
        } catch (error) {
          logger(`Error parsing schemaData for ${schemaName}:`, error)
          // Fall through to file-based loading
        }
      }

      // If it's not a draft and has schemaFileId, try to load from file
      if (dbSchema.isDraft === false && dbSchema.schemaFileId) {
        const completeSchemas = await listCompleteSchemaFiles()
        const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)
        
        if (matchingSchemas.length > 0) {
          // Find the schema with the highest version
          const latest = matchingSchemas.reduce((prev, current) =>
            current.version > prev.version ? current : prev,
          )

          // Read the file directly to get SchemaFileFormat
          const content = await BaseFileManager.readFileAsString(latest.filePath)
          const schemaFile = JSON.parse(content) as SchemaFileFormat

          // Ensure models are populated (fallback for seed-protocol if missing)
          if ((!schemaFile.models || Object.keys(schemaFile.models).length === 0) && schemaName === 'Seed Protocol') {
            try {
              const internalSchema = await import('@/seedSchema/seed-protocol-v1.json')
              const internalSchemaFile = internalSchema.default as SchemaFileFormat
              schemaFile.models = internalSchemaFile.models
              logger(`Populated models for seed-protocol schema from internal file`)
            } catch (error) {
              logger(`Error loading internal seed-protocol schema for models:`, error)
            }
          }

          logger(`Found existing schema ${schemaName} v${schemaFile.version} from file`)
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
          })
          return
        }
        
        // File doesn't exist, but we have schemaData in database - use it as fallback
        if (dbSchema.schemaData) {
          try {
            const schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
            logger(`Found published schema ${schemaName} v${schemaFile.version} in database (file not found, using schemaData)`)
            
            // Ensure models are populated (fallback for seed-protocol if missing)
            if ((!schemaFile.models || Object.keys(schemaFile.models).length === 0) && schemaName === 'Seed Protocol') {
              try {
                const internalSchema = await import('@/seedSchema/seed-protocol-v1.json')
                const internalSchemaFile = internalSchema.default as SchemaFileFormat
                schemaFile.models = internalSchemaFile.models
                logger(`Populated models for seed-protocol schema from internal file`)
              } catch (error) {
                logger(`Error loading internal seed-protocol schema for models:`, error)
              }
            }
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
            })
            return
          } catch (error) {
            logger(`Error parsing schemaData for published schema ${schemaName}:`, error)
            // Fall through to try internal schema or file-based loading
          }
        }
        
        // If schemaData is missing, try to load from internal schema file for seed-protocol
        if (!dbSchema.schemaData && schemaName === 'Seed Protocol') {
          try {
            const internalSchema = await import('@/seedSchema/seed-protocol-v1.json')
            const schemaFile = internalSchema.default as SchemaFileFormat
            logger(`Found seed-protocol schema in internal file (schemaData missing, using internal schema)`)
            
            // Update database with schemaData for future loads
            const schemaData = JSON.stringify(schemaFile, null, 2)
            await addSchemaToDb(
              {
                name: schemaName,
                version: dbSchema.version,
                createdAt: dbSchema.createdAt || new Date().getTime(),
                updatedAt: new Date().getTime(),
              },
              dbSchema.schemaFileId || schemaFile.id,
              schemaData,
              false, // isDraft = false
            )
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
            })
            return
          } catch (error) {
            logger(`Error loading internal seed-protocol schema:`, error)
            // Fall through to file-based loading
          }
        }
      }
    }

    // STEP 2: Check for existing schema files (for backward compatibility)
    const completeSchemas = await listCompleteSchemaFiles()
    const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)

    if (matchingSchemas.length > 0) {
      // Find the schema with the highest version
      const latest = matchingSchemas.reduce((prev, current) =>
        current.version > prev.version ? current : prev,
      )

      // Read the file directly to get SchemaFileFormat
      const content = await BaseFileManager.readFileAsString(latest.filePath)
      const schemaFile = JSON.parse(content) as SchemaFileFormat

      // Ensure models are populated (fallback for seed-protocol if missing)
      if ((!schemaFile.models || Object.keys(schemaFile.models).length === 0) && schemaName === 'Seed Protocol') {
        try {
          const internalSchema = await import('@/seedSchema/seed-protocol-v1.json')
          const internalSchemaFile = internalSchema.default as SchemaFileFormat
          schemaFile.models = internalSchemaFile.models
          logger(`Populated models for seed-protocol schema from internal file`)
        } catch (error) {
          logger(`Error loading internal seed-protocol schema for models:`, error)
        }
      }

      logger(`Found existing schema ${schemaName} v${schemaFile.version} from file`)
      sendBack({
        type: 'loadOrCreateSchemaSuccess',
        schema: schemaFile,
      })
      return
    }

    // STEP 3: Create new schema as draft in database (NOT in file yet)
    const latestVersion = await getLatestSchemaVersion(schemaName)
    const newVersion = latestVersion + 1

    const now = new Date().toISOString()
    const newSchema: SchemaFileFormat = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: newVersion,
      id: generateId(), // Generate schema ID when first written
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

    // Save to database as draft FIRST (before creating any file)
    const schemaData = JSON.stringify(newSchema, null, 2)
    await addSchemaToDb(
      {
        name: schemaName,
        version: newVersion,
        createdAt: new Date(now).getTime(),
        updatedAt: new Date(now).getTime(),
      },
      newSchema.id, // schemaFileId
      schemaData, // Full schema content
      true, // isDraft = true
    )

    logger(`Created new draft schema ${schemaName} v${newVersion} in database`)
    sendBack({
      type: 'loadOrCreateSchemaSuccess',
      schema: newSchema,
    })
  }

  _loadOrCreateSchema().catch((error) => {
    logger('Error loading or creating schema:', error)
    sendBack({ type: 'loadOrCreateSchemaError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})
