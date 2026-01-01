import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { getLatestSchemaVersion, listCompleteSchemaFiles } from '@/helpers/schema'
import { SchemaFileFormat } from '@/types/import'
import { BaseFileManager, generateId, } from '@/helpers'
import { addSchemaToDb, loadModelsFromDbForSchema } from '@/helpers/db'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq, and, desc } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:schema:actors:loadOrCreateSchema')

/**
 * Sanitize a schema name to be filesystem-safe
 * Replaces all special characters (except alphanumeric, hyphens, underscores) with underscores
 * Converts spaces to underscores
 * Removes leading/trailing underscores
 * 
 * @param name - Schema name to sanitize
 * @returns Sanitized name safe for use in filenames
 */
const sanitizeSchemaName = (name: string): string => {
  return name
    .replace(/[^a-zA-Z0-9\s_-]/g, '_') // Replace special chars (except spaces, hyphens, underscores) with underscore
    .replace(/\s+/g, '_') // Convert spaces to underscores
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .replace(/_+/g, '_') // Collapse multiple underscores to single
}

/**
 * Generate filename for a schema
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilename = (name: string, version: number, schemaFileId: string): string => {
  const sanitizedName = sanitizeSchemaName(name)
  return `${schemaFileId}_${sanitizedName}_v${version}.json`
}

/**
 * Get the full file path for a schema
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilePath = (name: string, version: number, schemaFileId: string): string => {
  const path = BaseFileManager.getPathModule()
  const filename = getSchemaFilename(name, version, schemaFileId)
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, filename)
}

export const loadOrCreateSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateSchema = async (): Promise<void> => {
    const { schemaName } = context
    
    // Check if this is an internal SDK schema (should not create files in app directory)
    const { isInternalSchema, SEED_PROTOCOL_SCHEMA_NAME } = await import('@/helpers/constants')
    const isInternal = isInternalSchema(schemaName)
    
    if (isInternal && schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
      // For Seed Protocol, always load from internal file, never create new
      logger(`Loading internal Seed Protocol schema from SDK`)
      try {
        const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
        const schemaFile = internalSchema.default as SchemaFileFormat
        
        // Check if it exists in database, if not, add it
        const db = BaseDb.getAppDb()
        if (db && schemaFile.id) {
          const existing = await db
            .select()
            .from(schemas)
            .where(eq(schemas.schemaFileId, schemaFile.id))
            .limit(1)
          
          if (existing.length === 0) {
            // Add to database if not present
            const schemaData = JSON.stringify(schemaFile, null, 2)
            await addSchemaToDb(
              {
                name: schemaName,
                version: schemaFile.version,
                createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
                updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
              },
              schemaFile.id,
              schemaData,
              false, // isDraft = false (it's a published internal schema)
            )
            logger(`Added Seed Protocol schema to database`)
          }
        }
        
        sendBack({
          type: 'loadOrCreateSchemaSuccess',
          schema: schemaFile,
        })
        return
      } catch (error) {
        logger(`Error loading internal Seed Protocol schema: ${error}`)
        // Fall through to normal loading logic
      }
    }

    if (!schemaName) {
      throw new Error('Schema name is required')
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not found')
    }

    // STEP 1: Query database first for existing schema (prefer drafts)
    // First try by name (most common case)
    let dbSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, schemaName))
      .orderBy(desc(schemas.isDraft), desc(schemas.version))
      .limit(1)

    // If not found by name, or if found but it's not a draft, try to find by schemaFileId from file
    // This handles the case where a draft's name was changed but we're loading by the old name
    const shouldTrySchemaFileId = dbSchemas.length === 0 || (dbSchemas.length > 0 && dbSchemas[0].isDraft === false)
    
    if (shouldTrySchemaFileId) {
      // First, try to get schemaFileId from file if it exists
      const completeSchemas = await listCompleteSchemaFiles()
      const matchingFileSchemas = completeSchemas.filter((s) => s.name === schemaName)
      
      if (matchingFileSchemas.length > 0) {
        const latestFile = matchingFileSchemas.reduce((prev, current) =>
          current.version > prev.version ? current : prev,
        )
        
        // Read file to get schemaFileId
        try {
          const content = await BaseFileManager.readFileAsString(latestFile.filePath)
          const fileSchema = JSON.parse(content) as SchemaFileFormat
          
          if (fileSchema.id) {
            // Look up by schemaFileId - query for DRAFTS first, then published
            // This ensures we find the draft even if there's also a published version
            const draftsByFileId = await db
              .select()
              .from(schemas)
              .where(and(
                eq(schemas.schemaFileId, fileSchema.id),
                eq(schemas.isDraft, true)
              ))
              .orderBy(desc(schemas.version))
              .limit(1)
            
            if (draftsByFileId.length > 0) {
              logger(`Found DRAFT by schemaFileId ${fileSchema.id} (name in DB: ${draftsByFileId[0].name}, requested name: ${schemaName})`)
              dbSchemas = draftsByFileId
            } else {
              // No draft found, check for any record with this schemaFileId
              const dbSchemasByFileId = await db
                .select()
                .from(schemas)
                .where(eq(schemas.schemaFileId, fileSchema.id))
                .orderBy(desc(schemas.isDraft), desc(schemas.version))
                .limit(1)
              
              if (dbSchemasByFileId.length > 0) {
                const foundSchema = dbSchemasByFileId[0]
                logger(`Found schema by schemaFileId ${fileSchema.id} (name in DB: ${foundSchema.name}, requested name: ${schemaName}, isDraft: ${foundSchema.isDraft})`)
                
                // Always prefer the one found by schemaFileId if we didn't find anything by name
                // OR if the one found by schemaFileId is a draft (even if we found a non-draft by name)
                if (foundSchema.isDraft === true || dbSchemas.length === 0) {
                  dbSchemas = dbSchemasByFileId
                  logger(`Using schema found by schemaFileId (isDraft: ${foundSchema.isDraft})`)
                } else if (foundSchema.isDraft === false && dbSchemas.length > 0 && dbSchemas[0].isDraft === false) {
                  // Both are non-drafts, prefer the one found by schemaFileId (more reliable)
                  dbSchemas = dbSchemasByFileId
                  logger(`Both schemas are non-drafts, using the one found by schemaFileId`)
                } else {
                  logger(`Keeping schema found by name (isDraft: ${dbSchemas[0].isDraft}) over schemaFileId result (isDraft: ${foundSchema.isDraft})`)
                }
              }
            }
          }
        } catch (error) {
          logger(`Error reading file to get schemaFileId: ${error}`)
        }
      }
      
      // If still not found and no file exists, try querying all drafts to see if any have metadata.name matching
      // This handles the case where a draft was renamed but there's no file (draft-only schema)
      if (dbSchemas.length === 0) {
        logger(`No schema found by name "${schemaName}" and no matching file, checking all drafts for potential match`)
        const allDrafts = await db
          .select()
          .from(schemas)
          .where(eq(schemas.isDraft, true))
          .orderBy(desc(schemas.version))
        
        logger(`Checking ${allDrafts.length} drafts for normalized name match`)
        
        // Check each draft's schemaData to see if metadata.name matches
        // Use case-insensitive and normalized comparison to handle name changes like "blog-schema" -> "Blog Schema"
        const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const normalizedRequested = normalizeName(schemaName)
        logger(`Normalized requested name: "${schemaName}" -> "${normalizedRequested}"`)
        
        for (const draft of allDrafts) {
          if (draft.schemaData) {
            try {
              const draftSchema = JSON.parse(draft.schemaData) as SchemaFileFormat
              const draftMetadataName = draftSchema.metadata?.name || ''
              const draftDbName = draft.name || ''
              
              // Check if normalized names match (handles "blog-schema" vs "Blog Schema")
              const normalizedDraftMetadata = normalizeName(draftMetadataName)
              const normalizedDraftDb = normalizeName(draftDbName)
              
              logger(`Checking draft: DB name="${draftDbName}" (normalized: "${normalizedDraftDb}"), metadata.name="${draftMetadataName}" (normalized: "${normalizedDraftMetadata}")`)
              
              if (normalizedDraftMetadata === normalizedRequested || normalizedDraftDb === normalizedRequested) {
                dbSchemas = [draft]
                logger(`Found draft by normalized name match: DB name="${draftDbName}", metadata.name="${draftMetadataName}", requested="${schemaName}" (normalized: "${normalizedRequested}")`)
                break
              }
            } catch (error) {
              logger(`Error parsing draft schemaData: ${error}`)
              // Skip drafts with invalid schemaData
              continue
            }
          } else {
            logger(`Draft ${draft.name} (id: ${draft.id}) has no schemaData, skipping`)
          }
        }
        
        if (dbSchemas.length === 0) {
          logger(`No draft found matching normalized name "${normalizedRequested}"`)
        }
      }
    }

    if (dbSchemas.length > 0) {
      const dbSchema = dbSchemas[0]
      
      logger(`Found schema record: name="${dbSchema.name}", isDraft=${dbSchema.isDraft}, hasSchemaData=${!!dbSchema.schemaData}, schemaFileId="${dbSchema.schemaFileId}"`)

      // If it's a draft, load from schemaData
      if (dbSchema.isDraft === true && dbSchema.schemaData) {
        try {
          const schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
          logger(`Found draft schema ${schemaName} v${schemaFile.version} in database (DB name: ${dbSchema.name}, metadata.name: ${schemaFile.metadata?.name})`)
          
          // CRITICAL: Ensure schema.id matches schemaFileId from database (database is source of truth)
          if (dbSchema.schemaFileId && schemaFile.id !== dbSchema.schemaFileId) {
            logger(`Fixing schema ID mismatch: schema.id="${schemaFile.id}" does not match schemaFileId="${dbSchema.schemaFileId}" from database. Using database value as source of truth.`)
            schemaFile.id = dbSchema.schemaFileId
          } else if (!schemaFile.id && dbSchema.schemaFileId) {
            logger(`Schema missing id, using schemaFileId from database: "${dbSchema.schemaFileId}"`)
            schemaFile.id = dbSchema.schemaFileId
          }
          
          // Verify metadata matches what we expect
          if (schemaFile.metadata?.name !== dbSchema.name) {
            logger(`WARNING: Metadata name mismatch! DB name="${dbSchema.name}", metadata.name="${schemaFile.metadata?.name}"`)
          }
          
          // Ensure models are populated (fallback for seed-protocol if missing)
          if ((!schemaFile.models || Object.keys(schemaFile.models).length === 0) && schemaName === 'Seed Protocol') {
            try {
              const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
              const internalSchemaFile = internalSchema.default as SchemaFileFormat
              schemaFile.models = internalSchemaFile.models
              logger(`Populated models for seed-protocol schema from internal file`)
            } catch (error) {
              logger(`Error loading internal seed-protocol schema for models:`, error)
            }
          }
          
          // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
          // This ensures models added to the database are included even if they're not in schemaData
          if (dbSchema.id) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              logger(`Found ${Object.keys(dbModels).length} models in database for schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
              // Merge: database models take precedence for properties, but preserve schemaData models for full structure
              schemaFile.models = {
                ...schemaFile.models,
                ...dbModels,
              }
              // For models that exist in both, merge properties (database properties override)
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (schemaFile.models[modelName]) {
                  // Merge properties, with database properties taking precedence
                  schemaFile.models[modelName] = {
                    ...schemaFile.models[modelName],
                    properties: {
                      ...schemaFile.models[modelName].properties,
                      ...dbModel.properties,
                    },
                  }
                }
              }
            }
          }
          
          // Debug: Log what we're sending
          logger(`Sending schema with ${Object.keys(schemaFile.models || {}).length} models: ${Object.keys(schemaFile.models || {}).join(', ')}`)
          
          // Track conflict detection metadata
          const loadedAt = Date.now()
          const dbVersion = dbSchema.version
          const dbUpdatedAt = dbSchema.updatedAt || loadedAt
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
          } as any)
          return
        } catch (error) {
          logger(`Error parsing schemaData for ${schemaName}:`, error)
          // Fall through to file-based loading
        }
      }

      // If it's not a draft and has schemaFileId, try to load from file
      // BUT: First check if there's a draft with the same schemaFileId (in case name changed)
      if (dbSchema.isDraft === false && dbSchema.schemaFileId) {
        logger(`Schema is not a draft (isDraft=${dbSchema.isDraft}), checking if there's a draft with same schemaFileId before loading from file`)
        
        // Check for a draft with the same schemaFileId (handles name changes)
        const draftsByFileId = await db
          .select()
          .from(schemas)
          .where(and(
            eq(schemas.schemaFileId, dbSchema.schemaFileId),
            eq(schemas.isDraft, true)
          ))
          .orderBy(desc(schemas.version))
          .limit(1)
        
        if (draftsByFileId.length > 0 && draftsByFileId[0].schemaData) {
          logger(`Found draft with same schemaFileId (name: "${draftsByFileId[0].name}"), using it instead of published version`)
          try {
            const schemaFile = JSON.parse(draftsByFileId[0].schemaData) as SchemaFileFormat
            logger(`Found draft schema ${schemaName} v${schemaFile.version} in database (DB name: ${draftsByFileId[0].name}, metadata.name: ${schemaFile.metadata?.name})`)
            
            // CRITICAL: Ensure schema.id matches schemaFileId from database (database is source of truth)
            if (draftsByFileId[0].schemaFileId && schemaFile.id !== draftsByFileId[0].schemaFileId) {
              logger(`Fixing schema ID mismatch: schema.id="${schemaFile.id}" does not match schemaFileId="${draftsByFileId[0].schemaFileId}" from database. Using database value as source of truth.`)
              schemaFile.id = draftsByFileId[0].schemaFileId
            } else if (!schemaFile.id && draftsByFileId[0].schemaFileId) {
              logger(`Schema missing id, using schemaFileId from database: "${draftsByFileId[0].schemaFileId}"`)
              schemaFile.id = draftsByFileId[0].schemaFileId
            }
            
            // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
            // This ensures models added to the database are included even if they're not in schemaData
            if (draftsByFileId[0].id) {
              const dbModels = await loadModelsFromDbForSchema(draftsByFileId[0].id)
              if (Object.keys(dbModels).length > 0) {
                logger(`Found ${Object.keys(dbModels).length} models in database for draft schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
                // Merge: database models take precedence for properties, but preserve schemaData models for full structure
                schemaFile.models = {
                  ...schemaFile.models,
                  ...dbModels,
                }
                // For models that exist in both, merge properties (database properties override)
                for (const [modelName, dbModel] of Object.entries(dbModels)) {
                  if (schemaFile.models[modelName]) {
                    // Merge properties, with database properties taking precedence
                    schemaFile.models[modelName] = {
                      ...schemaFile.models[modelName],
                      properties: {
                        ...schemaFile.models[modelName].properties,
                        ...dbModel.properties,
                      },
                    }
                  }
                }
              }
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = draftsByFileId[0].version || schemaFile.version
            const dbUpdatedAt = draftsByFileId[0].updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
            } as any)
            return
          } catch (error) {
            logger(`Error parsing draft schemaData: ${error}, falling back to file`)
          }
        }
        
        logger(`No draft found with same schemaFileId, will try to load from file instead of schemaData`)
        
        // Try ID-based file lookup first (preferred)
        let schemaFile: SchemaFileFormat | null = null
        if (dbSchema.schemaFileId) {
          try {
            // Try to find file by schemaFileId in the complete schemas list
            const completeSchemas = await listCompleteSchemaFiles()
            const idBasedMatch = completeSchemas.find((s) => s.schemaFileId === dbSchema.schemaFileId)
            
            if (idBasedMatch) {
              logger(`Found schema file by schemaFileId: ${idBasedMatch.filePath}`)
              const content = await BaseFileManager.readFileAsString(idBasedMatch.filePath)
              schemaFile = JSON.parse(content) as SchemaFileFormat
            } else {
              // Try direct file path lookup by ID
              const idBasedPath = getSchemaFilePath(dbSchema.name, dbSchema.version, dbSchema.schemaFileId)
              try {
                const content = await BaseFileManager.readFileAsString(idBasedPath)
                schemaFile = JSON.parse(content) as SchemaFileFormat
                logger(`Found schema file by direct ID-based path: ${idBasedPath}`)
              } catch {
                // ID-based file doesn't exist, fall through to name-based
              }
            }
          } catch (error) {
            logger(`Error loading ID-based file: ${error}, falling back to name-based`)
          }
        }
        
        // Fall back to name-based file lookup (backward compatibility)
        if (!schemaFile) {
          const completeSchemas = await listCompleteSchemaFiles()
          const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)
          
          if (matchingSchemas.length > 0) {
            // Find the schema with the highest version
            const latest = matchingSchemas.reduce((prev, current) =>
              current.version > prev.version ? current : prev,
            )

            // Read the file directly to get SchemaFileFormat
            const content = await BaseFileManager.readFileAsString(latest.filePath)
            schemaFile = JSON.parse(content) as SchemaFileFormat
          }
        }
        
        if (schemaFile) {

          // Ensure models are populated (fallback for seed-protocol if missing)
          if ((!schemaFile.models || Object.keys(schemaFile.models).length === 0) && schemaName === 'Seed Protocol') {
            try {
              const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
              const internalSchemaFile = internalSchema.default as SchemaFileFormat
              schemaFile.models = internalSchemaFile.models
              logger(`Populated models for seed-protocol schema from internal file`)
            } catch (error) {
              logger(`Error loading internal seed-protocol schema for models:`, error)
            }
          }

          // CRITICAL: Merge models from database (model_schemas join table) with models from file
          // This ensures models added to the database are included even if they're not in the file
          if (dbSchema.id) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              logger(`Found ${Object.keys(dbModels).length} models in database for schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
              // Merge: database models take precedence for properties, but preserve file models for full structure
              schemaFile.models = {
                ...schemaFile.models,
                ...dbModels,
              }
              // For models that exist in both, merge properties (database properties override)
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (schemaFile.models[modelName]) {
                  // Merge properties, with database properties taking precedence
                  schemaFile.models[modelName] = {
                    ...schemaFile.models[modelName],
                    properties: {
                      ...schemaFile.models[modelName].properties,
                      ...dbModel.properties,
                    },
                  }
                }
              }
            }
          }

          logger(`Found existing schema ${schemaName} v${schemaFile.version} from file`)
          // Debug: Log what we're sending
          logger(`Sending schema with ${Object.keys(schemaFile.models || {}).length} models: ${Object.keys(schemaFile.models || {}).join(', ')}`)
          
          // Track conflict detection metadata from DB record
          const loadedAt = Date.now()
          const dbVersion = dbSchema.version || schemaFile.version
          const dbUpdatedAt = dbSchema.updatedAt || loadedAt
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
          } as any)
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
                const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
                const internalSchemaFile = internalSchema.default as SchemaFileFormat
                schemaFile.models = internalSchemaFile.models
                logger(`Populated models for seed-protocol schema from internal file`)
              } catch (error) {
                logger(`Error loading internal seed-protocol schema for models:`, error)
              }
            }
            
            // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
            // This ensures models added to the database are included even if they're not in schemaData
            if (dbSchema.id) {
              const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
              if (Object.keys(dbModels).length > 0) {
                logger(`Found ${Object.keys(dbModels).length} models in database for schema ${schemaName}: ${Object.keys(dbModels).join(', ')}`)
                // Merge: database models take precedence for properties, but preserve schemaData models for full structure
                schemaFile.models = {
                  ...schemaFile.models,
                  ...dbModels,
                }
                // For models that exist in both, merge properties (database properties override)
                for (const [modelName, dbModel] of Object.entries(dbModels)) {
                  if (schemaFile.models[modelName]) {
                    // Merge properties, with database properties taking precedence
                    schemaFile.models[modelName] = {
                      ...schemaFile.models[modelName],
                      properties: {
                        ...schemaFile.models[modelName].properties,
                        ...dbModel.properties,
                      },
                    }
                  }
                }
              }
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = dbSchema.version || schemaFile.version
            const dbUpdatedAt = dbSchema.updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
            } as any)
            return
          } catch (error) {
            logger(`Error parsing schemaData for published schema ${schemaName}:`, error)
            // Fall through to try internal schema or file-based loading
          }
        }
        
        // If schemaData is missing, try to load from internal schema file for seed-protocol
        if (!dbSchema.schemaData && schemaName === 'Seed Protocol') {
          try {
            const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
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
    // BUT: Only load from file if we didn't find a draft in the database
    // This prevents loading old file data when a draft with a renamed schema exists
    const completeSchemas = await listCompleteSchemaFiles()
    const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)

    if (matchingSchemas.length > 0) {
      // Before loading from file, check if there's a draft in the database that might match
      // (This handles the case where the schema was renamed but the file still has the old name)
      const allDrafts = await db
        .select()
        .from(schemas)
        .where(eq(schemas.isDraft, true))
        .orderBy(desc(schemas.version))
      
      const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const normalizedRequested = normalizeName(schemaName)
      
      // Check if any draft matches by normalized name
      let matchingDraft = null
      for (const draft of allDrafts) {
        if (draft.schemaData) {
          try {
            const draftSchema = JSON.parse(draft.schemaData) as SchemaFileFormat
            const draftMetadataName = draftSchema.metadata?.name || ''
            const draftDbName = draft.name || ''
            
            const normalizedDraftMetadata = normalizeName(draftMetadataName)
            const normalizedDraftDb = normalizeName(draftDbName)
            
            if (normalizedDraftMetadata === normalizedRequested || normalizedDraftDb === normalizedRequested) {
              matchingDraft = draft
              logger(`Found matching draft in database (DB name: "${draftDbName}", metadata.name: "${draftMetadataName}") - preferring it over file with old name "${schemaName}"`)
              break
            }
          } catch (error) {
            continue
          }
        }
      }
      
      // If we found a matching draft, use it instead of the file
      if (matchingDraft && matchingDraft.schemaData) {
        try {
          const schemaFile = JSON.parse(matchingDraft.schemaData) as SchemaFileFormat
          logger(`Loading draft from database instead of file (draft has name "${matchingDraft.name}", file has "${schemaName}")`)
          
          // Track conflict detection metadata
          const loadedAt = Date.now()
          const dbVersion = matchingDraft.version || schemaFile.version
          const dbUpdatedAt = matchingDraft.updatedAt || loadedAt
          
          sendBack({
            type: 'loadOrCreateSchemaSuccess',
            schema: schemaFile,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
          } as any)
          return
        } catch (error) {
          logger(`Error parsing draft schemaData, falling back to file: ${error}`)
        }
      }
      
      // No matching draft found, proceed with loading from file
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
          const internalSchema = await import('@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
          const internalSchemaFile = internalSchema.default as SchemaFileFormat
          schemaFile.models = internalSchemaFile.models
          logger(`Populated models for seed-protocol schema from internal file`)
        } catch (error) {
          logger(`Error loading internal seed-protocol schema for models:`, error)
        }
      }

      logger(`Found existing schema ${schemaName} v${schemaFile.version} from file`)
      
      // Track conflict detection metadata (no DB record, use file metadata)
      const loadedAt = Date.now()
      const dbVersion = schemaFile.version
      const dbUpdatedAt = new Date(schemaFile.metadata.updatedAt).getTime() || loadedAt
      
      sendBack({
        type: 'loadOrCreateSchemaSuccess',
        schema: schemaFile,
        loadedAt,
        dbVersion,
        dbUpdatedAt,
      } as any)
      return
    }

    // STEP 3: Before creating new schema, check database one more time for any existing record
    // This handles the case where a schema exists in DB but wasn't found by name (e.g., name mismatch)
    // or where the file lookup failed but the DB has the correct schemaFileId
    let existingDbSchema: typeof schemas.$inferSelect | undefined
    try {
      const dbCheck = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, schemaName))
        .orderBy(desc(schemas.version))
        .limit(1)
      
      if (dbCheck.length > 0) {
        const foundSchema = dbCheck[0]
        existingDbSchema = foundSchema
        logger(`Found existing DB record for "${schemaName}" before creating new schema (schemaFileId: ${foundSchema.schemaFileId}, isDraft: ${foundSchema.isDraft})`)
        
        // If we have a schemaFileId, check if file exists with that ID
        if (foundSchema.schemaFileId) {
          const filePath = getSchemaFilePath(schemaName, foundSchema.version, foundSchema.schemaFileId)
          const fileExists = await BaseFileManager.pathExists(filePath)
          
          if (fileExists) {
            logger(`File exists for schemaFileId ${foundSchema.schemaFileId}, loading it instead of creating new schema`)
            const content = await BaseFileManager.readFileAsString(filePath)
            const schemaFile = JSON.parse(content) as SchemaFileFormat
            
            // Ensure schema.id matches schemaFileId from database
            if (schemaFile.id !== foundSchema.schemaFileId) {
              logger(`Fixing schema ID mismatch: file has id="${schemaFile.id}", DB has schemaFileId="${foundSchema.schemaFileId}". Using DB value.`)
              schemaFile.id = foundSchema.schemaFileId
            }
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = foundSchema.version || schemaFile.version
            const dbUpdatedAt = foundSchema.updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
            } as any)
            return
          }
        }
        
        // If it's a draft, load it from schemaData
        if (foundSchema.isDraft === true && foundSchema.schemaData) {
          try {
            const schemaFile = JSON.parse(foundSchema.schemaData) as SchemaFileFormat
            
            // Ensure schema.id matches schemaFileId from database
            if (foundSchema.schemaFileId && schemaFile.id !== foundSchema.schemaFileId) {
              logger(`Fixing schema ID mismatch: schemaData has id="${schemaFile.id}", DB has schemaFileId="${foundSchema.schemaFileId}". Using DB value.`)
              schemaFile.id = foundSchema.schemaFileId
            }
            
            logger(`Loading existing draft from database instead of creating new schema`)
            
            // Track conflict detection metadata
            const loadedAt = Date.now()
            const dbVersion = foundSchema.version || schemaFile.version
            const dbUpdatedAt = foundSchema.updatedAt || loadedAt
            
            sendBack({
              type: 'loadOrCreateSchemaSuccess',
              schema: schemaFile,
              loadedAt,
              dbVersion,
              dbUpdatedAt,
            } as any)
            return
          } catch (error) {
            logger(`Error parsing existing draft schemaData: ${error}, will create new schema`)
          }
        }
      }
    } catch (error) {
      logger(`Error checking database before creating new schema: ${error}, proceeding with creation`)
    }

    // STEP 4: Create new schema as draft in database (NOT in file yet)
    const latestVersion = existingDbSchema?.version ? existingDbSchema.version + 1 : await getLatestSchemaVersion(schemaName)
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
    
    // Track conflict detection metadata for new schema
    const loadedAt = Date.now()
    const dbVersion = newVersion
    const dbUpdatedAt = new Date(now).getTime()
    
    sendBack({
      type: 'loadOrCreateSchemaSuccess',
      schema: newSchema,
      loadedAt,
      dbVersion,
      dbUpdatedAt,
    } as any)
  }

  _loadOrCreateSchema().catch((error) => {
    logger('Error loading or creating schema:', error)
    sendBack({ type: 'loadOrCreateSchemaError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})
