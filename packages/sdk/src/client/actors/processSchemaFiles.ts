import { EventObject, fromCallback } from "xstate"
import { ClientManagerContext, FromCallbackInput } from "@/types/machines"
import { ClientManagerEvents } from "@/client/constants"
import { isInternalSchema, INTERNAL_SCHEMA_IDS } from "@/helpers/constants"
import { listSchemaFiles, loadAllSchemasFromDb } from "@/helpers/schema"
import { BaseDb } from "@/db/Db/BaseDb"
import { schemas as schemasTable } from "@/seedSchema/SchemaSchema"
import { eq } from "drizzle-orm"
import {
  createModelsFromJson,
  createModelsFromJsonFile,
  importJsonSchema,
  loadSchemaFromFile,
  syncSchemaFromSource,
} from "@/imports/json"
import { SchemaFileFormat } from "@/types/import"
import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager"
import { isNode } from "@/helpers/environment"
import debug from "debug"
import internalSchema from "@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json"

const logger = debug('seedSdk:client:actors:processSchemaFiles')

let processSchemaFilesChain: Promise<void> = Promise.resolve()

function resolveSchemaFilePath(schemaFile: string): string {
  const path = BaseFileManager.getPathModule()
  if (path.isAbsolute(schemaFile)) {
    return schemaFile
  }
  if (isNode()) {
    return path.resolve(process.cwd(), schemaFile)
  }
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, schemaFile)
}

// Timeout for the entire schema processing operation (120 seconds)
// Schema processing can be slow with syncSchemaFromSource, loadAllSchemasFromDb, and OPFS file I/O
const PROCESS_SCHEMA_FILES_TIMEOUT_MS = 120000

export const processSchemaFiles = fromCallback<
  EventObject,
  FromCallbackInput<ClientManagerContext>
>(({ sendBack, input: { context } }) => {
  logger('processSchemaFiles started')

  let hasResponded = false
  let timeoutId: NodeJS.Timeout | null = null

  const reportError = (error: Error) => {
    if (!hasResponded) {
      hasResponded = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      logger('processSchemaFiles error:', error)
      sendBack({ 
        type: 'error', 
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  const reportSuccess = () => {
    if (!hasResponded) {
      hasResponded = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      logger('processSchemaFiles completed')
      sendBack({ type: ClientManagerEvents.PROCESS_SCHEMA_FILES_SUCCESS })
    }
  }

  // Set up a single timeout for the entire operation
  timeoutId = setTimeout(() => {
    reportError(new Error(`processSchemaFiles timed out after ${PROCESS_SCHEMA_FILES_TIMEOUT_MS}ms`))
  }, PROCESS_SCHEMA_FILES_TIMEOUT_MS)

  const _processSchemaFiles = async () => {
    // First, load the internal seed-protocol schema
    logger('Loading internal seed-protocol schema')
    const internalSchemaData = internalSchema as SchemaFileFormat
    const db = BaseDb.getAppDb()
    const internalSchemaExists = db
      ? (await db.select().from(schemasTable).where(eq(schemasTable.schemaFileId, INTERNAL_SCHEMA_IDS[0])).limit(1)).length > 0
      : false
    if (internalSchemaExists) {
      logger('Internal seed-protocol schema already in DB, skipping import')
    } else {
      try {
        // Import the internal schema to database (will create models and add to store)
        await importJsonSchema({ contents: JSON.stringify(internalSchemaData) }, internalSchemaData.version)
        logger(`Loaded internal seed-protocol schema v${internalSchemaData.version}`)
      } catch (error: any) {
        // If schema already exists, that's fine - it means it was already loaded
        if (error?.message?.includes('already exists')) {
          logger('Internal seed-protocol schema already loaded')
        } else {
          logger('Error loading internal seed-protocol schema:', error)
          // Don't fail if internal schema can't be loaded - it might already be in DB
        }
      }
    }

    // If schema (canonical) is provided, sync it - takes precedence over schemaFile
    if (context.schema) {
      // Skip sync when schema is internal (already loaded above)
      const schemaName = typeof context.schema === 'object' && context.schema?.metadata?.name
        ? String(context.schema.metadata.name)
        : ''
      const schemaId = typeof context.schema === 'object' && context.schema?.id ? String(context.schema.id) : undefined
      if (isInternalSchema(schemaName, schemaId)) {
        logger('Schema is internal (Seed Protocol), already loaded - skipping syncSchemaFromSource')
      } else {
        try {
          await syncSchemaFromSource(context.schema)
          logger(`Synced canonical schema from ${typeof context.schema === 'string' ? context.schema : 'object'}`)
        } catch (error: any) {
          logger(`Error syncing canonical schema:`, error)
          // Don't fail init - schema might already be in DB
        }
      }
    } else if (context.schemaFile) {
      // Legacy: schemaFile - load via importJsonSchema
      try {
        const resolvedPath = resolveSchemaFilePath(context.schemaFile)
        const content = await BaseFileManager.readFileAsString(resolvedPath)
        await importJsonSchema({ contents: content })
        logger(`Loaded schema from ${resolvedPath}`)
      } catch (error: any) {
        logger(`Error loading schema file ${context.schemaFile}:`, error)
        // Don't fail init - schema might already be in DB
      }
    }

    // Process minimal import files (files without $schema) - skip when canonical schema is set
    if (!context.schema) {
      logger('Listing schema files')
      let schemaFiles: Array<{ name: string; version: number; filePath: string }> = []
      try {
        schemaFiles = await listSchemaFiles()
        logger(`Found ${schemaFiles.length} schema files to process`)
      } catch (error) {
        logger('Error listing schema files (continuing anyway):', error)
        schemaFiles = []
      }

      for (const schemaFile of schemaFiles) {
        try {
          await importJsonSchema(schemaFile.filePath)
        } catch (error) {
          logger(`Error importing schema file ${schemaFile.filePath}:`, error)
        }
      }
    }

    // Track schema name we just synced from config.schema - skip redundant loadSchemaFromFile for it
    // (loadSchemaFromFile was already called inside syncSchemaFromSource; calling again creates duplicate models)
    const syncedSchemaName =
      context.schema && typeof context.schema === 'object' && (context.schema as any)?.metadata?.name
        ? String((context.schema as any).metadata.name)
        : null

    // Then, load all schemas using the unified database-first approach
    logger('Loading schemas from database and files')
    let allSchemasData: Array<{ schema: SchemaFileFormat; isDraft: boolean; source: string }> = []
    try {
      allSchemasData = await loadAllSchemasFromDb()
      logger(`Loaded ${allSchemasData.length} schemas (${allSchemasData.filter(s => s.isDraft).length} drafts, ${allSchemasData.filter(s => !s.isDraft).length} published)`)
    } catch (error) {
      logger('Error loading schemas from database (continuing anyway):', error)
      // Continue with empty array - this is not critical for initialization
      // Schemas can be loaded on-demand later
      allSchemasData = []
    }
    // Collect models to add to context (schemas are now loaded on-demand via database queries)
    const allModels: { [key: string]: any } = { ...(context.models || {}) }
    
    for (const schemaData of allSchemasData) {
      const schema = schemaData.schema
      const schemaName = schema.metadata?.name || 'unknown'
      
      logger(`Processing schema: ${schemaName} v${schema.version} (${schemaData.isDraft ? 'draft' : 'published'}, source: ${schemaData.source})`)
      
      // For published schemas (not drafts), load models from file if available
      if (!schemaData.isDraft && schema.id) {
        const { listCompleteSchemaFiles } = await import('@/helpers/schema')
        const completeSchemas = await listCompleteSchemaFiles()
        const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)
        const latest = matchingSchemas.length > 0
          ? matchingSchemas.reduce((prev, current) =>
              current.version > prev.version ? current : prev,
            )
          : null

        const fileExists = latest ? await BaseFileManager.pathExists(latest.filePath) : false
        if (latest && fileExists) {
          try {
            // Skip loadSchemaFromFile when we already synced this schema via config.schema - it would
            // create duplicate models (Publication 1, Identity 1, etc.). Use createModelsFromJsonFile
            // only to get model definitions for context.
            if (syncedSchemaName && schemaName === syncedSchemaName) {
              const modelDefinitions = await createModelsFromJsonFile(latest.filePath)
              Object.assign(allModels, modelDefinitions)
            } else {
              await loadSchemaFromFile(latest.filePath)
              const modelDefinitions = await createModelsFromJsonFile(latest.filePath)
              Object.assign(allModels, modelDefinitions)
            }
          } catch (error) {
            logger(`Error loading schema file for ${schemaName}:`, error)
          }
        } else {
          // File doesn't exist (e.g. schema passed via config.schema) - use schema data from loadAllSchemasFromDb
          try {
            const schemaModels = schema.models as Record<string, { properties?: Record<string, any> }>
            if (schemaModels && Object.keys(schemaModels).length > 0) {
              const modelFileIds = new Map<string, string>()
              const propertyFileIds = new Map<string, Map<string, string>>()
              for (const [modelName, model] of Object.entries(schemaModels)) {
                const modelId = (model as any).id
                if (modelId) modelFileIds.set(modelName, modelId)
                if (model.properties) {
                  const propIds = new Map<string, string>()
                  for (const [propName, prop] of Object.entries(model.properties)) {
                    const propId = (prop as any).id
                    if (propId) propIds.set(propName, propId)
                  }
                  if (propIds.size > 0) propertyFileIds.set(modelName, propIds)
                }
              }
              const importData = {
                name: schemaName,
                models: Object.fromEntries(
                  Object.entries(schemaModels).map(([modelName, model]) => [
                    modelName,
                    {
                      description: (model as any).description,
                      properties: Object.fromEntries(
                        Object.entries(model.properties || {}).map(([propName, prop]) => {
                          const p = prop as any
                          return [
                            propName,
                            {
                              type: p.dataType || p.type,
                              model: p.refModelName || p.ref,
                              refValueType: p.refValueType,
                              ref: p.ref,
                              ...p,
                            },
                          ]
                        }),
                      ),
                    },
                  ]),
                ),
              }
              const modelDefinitions = await createModelsFromJson(
                importData as any,
                modelFileIds,
                propertyFileIds,
              )
              Object.assign(allModels, modelDefinitions)
              logger(`Loaded ${Object.keys(modelDefinitions).length} models from schema data for ${schemaName}`)
            }
          } catch (error) {
            logger(`Error creating models from schema data for ${schemaName}:`, error)
          }
        }
      } else if (schemaData.isDraft) {
        // For drafts, create models from the schema data
        try {
          const schemaModels = schema.models as Record<string, { properties?: Record<string, any> }>
          if (schemaModels && Object.keys(schemaModels).length > 0) {
            const modelFileIds = new Map<string, string>()
            const propertyFileIds = new Map<string, Map<string, string>>()
            for (const [modelName, model] of Object.entries(schemaModels)) {
              const modelId = (model as any).id
              if (modelId) modelFileIds.set(modelName, modelId)
              if (model.properties) {
                const propIds = new Map<string, string>()
                for (const [propName, prop] of Object.entries(model.properties)) {
                  const propId = (prop as any).id
                  if (propId) propIds.set(propName, propId)
                }
                if (propIds.size > 0) propertyFileIds.set(modelName, propIds)
              }
            }
            const importData = {
              name: schemaName,
              models: Object.fromEntries(
                Object.entries(schemaModels).map(([modelName, model]) => [
                  modelName,
                  {
                    description: (model as any).description,
                    properties: Object.fromEntries(
                      Object.entries(model.properties || {}).map(([propName, prop]) => {
                        const p = prop as any
                        return [
                          propName,
                          {
                            type: p.dataType || p.type,
                            model: p.refModelName || p.ref,
                            refValueType: p.refValueType,
                            ref: p.ref,
                            ...p,
                          },
                        ]
                      }),
                    ),
                  },
                ]),
              ),
            }
            const modelDefinitions = await createModelsFromJson(
              importData as any,
              modelFileIds,
              propertyFileIds,
            )
            Object.assign(allModels, modelDefinitions)
            logger(`Loaded ${Object.keys(modelDefinitions).length} models from draft schema ${schemaName}`)
          }
        } catch (error) {
          logger(`Error creating models from draft schema ${schemaName}:`, error)
        }
      }
      
      // Schemas are now loaded on-demand via database queries (useSchemas hook uses loadAllSchemasFromDb)
      // No need to populate context.schemas
    }

    // Update context with models only (schemas are loaded on-demand via database queries)
    sendBack({
      type: ClientManagerEvents.UPDATE_CONTEXT,
      context: {
        models: allModels,
      }
    })
  }

  processSchemaFilesChain = processSchemaFilesChain
    .then(() => _processSchemaFiles())
    .catch((err) => {
      logger('processSchemaFiles chain error:', err)
      throw err
    })
  processSchemaFilesChain.then(reportSuccess).catch((error) => {
    reportError(error instanceof Error ? error : new Error(String(error)))
  })

  // Cleanup function to clear timeout if actor is stopped
  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }
})