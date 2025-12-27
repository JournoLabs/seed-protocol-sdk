import { EventObject, fromCallback } from "xstate"
import { ClientManagerContext, FromCallbackInput } from "@/types/machines"
import { ClientManagerEvents } from "@/services/internal/constants"
import { listSchemaFiles, loadAllSchemasFromDb } from "@/helpers/schema"
// Dynamic import to break circular dependency: ClientManager -> processSchemaFiles -> imports/json -> ClientManager
// import { createModelsFromJsonFile, importJsonSchema, loadSchemaFromFile } from "@/imports/json"
import { SchemaFileFormat } from "@/types/import"
import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager"
import debug from "debug"
import internalSchema from "@/seedSchema/seed-protocol-v1.json"

const logger = debug('seedSdk:client:actors:processSchemaFiles')

export const processSchemaFiles = fromCallback<
  EventObject,
  FromCallbackInput<ClientManagerContext>
>(({ sendBack, input: { context } }) => {
  logger('processSchemaFiles started')

  const _processSchemaFiles = async () => {
    // Use dynamic import to break circular dependency
    const { importJsonSchema, loadSchemaFromFile, createModelsFromJsonFile } = await import('@/imports/json')
    
    // First, load the internal seed-protocol schema
    logger('Loading internal seed-protocol schema')
    try {
      const internalSchemaData = internalSchema as SchemaFileFormat
      // Import the internal schema to database (will create models and add to store)
      // This will only import if it doesn't already exist
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

    // Then, process minimal import files (files without $schema)
    const schemaFiles = await listSchemaFiles()
    for (const schemaFile of schemaFiles) {
      await importJsonSchema(schemaFile.filePath)
    }

    // Then, load all schemas using the unified database-first approach
    logger('Loading schemas from database and files')
    const allSchemasData = await loadAllSchemasFromDb()
    logger(`Loaded ${allSchemasData.length} schemas (${allSchemasData.filter(s => s.isDraft).length} drafts, ${allSchemasData.filter(s => !s.isDraft).length} published)`)
    
    // Collect all schemas to add to context
    const schemas: { [schemaName: string]: SchemaFileFormat } = { ...context.schemas }
    const allModels: { [key: string]: any } = { ...context.models }
    
    for (const schemaData of allSchemasData) {
      const schema = schemaData.schema
      const schemaName = schema.metadata?.name || 'unknown'
      
      logger(`Processing schema: ${schemaName} v${schema.version} (${schemaData.isDraft ? 'draft' : 'published'}, source: ${schemaData.source})`)
      
      // For published schemas (not drafts), load models from file if available
      // For drafts, we'll load models from the schema data itself
      if (!schemaData.isDraft && schema.id) {
        // Try to load from file if it exists (for published schemas)
        try {
          const path = BaseFileManager.getPathModule()
          const workingDir = BaseFileManager.getWorkingDir()
          const sanitizedName = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_')
          const filename = `${sanitizedName}-v${schema.version}.json`
          const filePath = path.join(workingDir, filename)
          
          if (await BaseFileManager.pathExists(filePath)) {
            await loadSchemaFromFile(filePath)
            const modelDefinitions = await createModelsFromJsonFile(filePath)
            Object.assign(allModels, modelDefinitions)
          } else {
            // File doesn't exist but schema is published - this shouldn't happen
            // but we can still process the schema data
            logger(`Warning: Published schema ${schemaName} v${schema.version} has no file, using DB data`)
          }
        } catch (error) {
          logger(`Error loading schema file for ${schemaName}:`, error)
        }
      } else if (schemaData.isDraft) {
        // For drafts, we need to create models from the schema data
        // This is a simplified version - in practice you might want to call
        // createModelsFromJson with the schema data
        logger(`Draft schema ${schemaName} - models will be loaded when schema is accessed`)
      }
      
      // Add schema to context
      schemas[schemaName] = schema
    }
    
    // Update context with all schemas and models at once
    sendBack({ 
      type: ClientManagerEvents.UPDATE_CONTEXT, 
      context: { 
        models: allModels,
        schemas: schemas,
      } 
    })
  }

  _processSchemaFiles().then(() => {
    logger('processSchemaFiles completed')
    sendBack({ type: ClientManagerEvents.PROCESS_SCHEMA_FILES_SUCCESS })
  }).catch((error) => {
    logger('processSchemaFiles error:', error)
    sendBack({ type: ClientManagerEvents.PROCESS_SCHEMA_FILES_SUCCESS })
  })
})