import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { getLatestSchemaVersion, listCompleteSchemaFiles } from '@/helpers/schema'
import { SchemaFileFormat } from '@/types/import'
import { BaseFileManager } from '@/helpers'
import { loadModelsFromDbForSchema } from '@/helpers/db'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { eq, and, desc } from 'drizzle-orm'
import debug from 'debug'
import { isInternalSchema, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const logger = debug('seedSdk:schema:actors:checkExistingSchema')

/**
 * Query model IDs (schemaFileId) from database for a given schema
 */
const getModelIdsForSchema = async (schemaId: number): Promise<string[]> => {
  const db = BaseDb.getAppDb()
  if (!db) {
    logger('Database not available, cannot query model IDs')
    return []
  }

  try {
    const modelRecords = await db
      .select({
        modelFileId: modelsTable.schemaFileId,
      })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaId))
    
    const modelIds = modelRecords
      .map((row: { modelFileId: string | null }) => row.modelFileId)
      .filter((id: string | null | undefined): id is string => id !== null && id !== undefined)
    
    logger(`Found ${modelIds.length} model IDs for schema (id: ${schemaId}): ${modelIds.join(', ')}`)
    return modelIds
  } catch (error) {
    logger(`Error querying model IDs for schema ${schemaId}:`, error)
    return []
  }
}

/**
 * Get the full file path for a schema
 */
const getSchemaFilePath = (name: string, version: number, schemaFileId: string): string => {
  const path = BaseFileManager.getPathModule()
  const sanitizeSchemaName = (name: string): string => {
    return name
      .replace(/[^a-zA-Z0-9\s_-]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
  }
  const sanitizedName = sanitizeSchemaName(name)
  const filename = `${schemaFileId}_${sanitizedName}_v${version}.json`
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, filename)
}

/**
 * Create Model instances for all model IDs to ensure they're cached
 */
const createModelInstances = async (modelIds: string[]): Promise<void> => {
  if (modelIds.length === 0) {
    return
  }

  try {
    const mod = await import('../../../Model/Model')
    const Model = mod?.Model ?? (mod as { default?: unknown })?.default
    if (!Model) {
      logger('Model not available from dynamic import')
      return
    }
    const createPromises = modelIds.map(async (modelFileId) => {
      try {
        const model = await Model.createById(modelFileId)
        if (model) {
          logger(`Created/cached Model instance for modelFileId "${modelFileId}"`)
        }
      } catch (error) {
        logger(`Error creating Model instance for modelFileId "${modelFileId}": ${error}`)
      }
    })
    
    await Promise.all(createPromises)
    logger(`Finished creating/caching ${modelIds.length} Model instances`)
  } catch (error) {
    logger(`Error in createModelInstances: ${error}`)
  }
}

export const checkExistingSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  const _check = async (): Promise<void> => {
    const { schemaName } = context
    
    if (!schemaName) {
      sendBack({
        type: 'schemaNotFound',
      })
      return
    }

    const db = BaseDb.getAppDb()
    if (!db) {
      sendBack({
        type: 'schemaNotFound',
      })
      return
    }

    // Check if this is an internal SDK schema (Seed Protocol) — use static import so consumer bundles resolve correctly
    const isInternal = isInternalSchema(schemaName)
    
    if (isInternal && schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
      // For Seed Protocol, check if it exists in database
      try {
        const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
        const schemaFile = internalSchema.default as SchemaFileFormat
        
        if (db && schemaFile.id) {
          const existing = await db
            .select()
            .from(schemas)
            .where(eq(schemas.schemaFileId, schemaFile.id))
            .limit(1)
          
          if (existing.length > 0) {
            const schemaRecord = existing[0]
            let modelIds: string[] = []
            if (schemaRecord.id) {
              modelIds = await getModelIdsForSchema(schemaRecord.id)
              await createModelInstances(modelIds)
            }
            
            sendBack({
              type: 'schemaFound',
              schema: schemaFile,
              schemaRecord,
              modelIds,
            })
            return
          }
        }
      } catch (error) {
        logger(`Error checking internal Seed Protocol schema: ${error}`)
      }
    }

    // STEP 1: Query database first for existing schema (prefer drafts)
    let dbSchemas = await db
      .select()
      .from(schemas)
      .where(eq(schemas.name, schemaName))
      .orderBy(desc(schemas.isDraft), desc(schemas.version))
      .limit(1)

    // If not found by name, try querying by schemaFileId
    if (dbSchemas.length === 0) {
      logger(`No schema found by name "${schemaName}", trying to find by schemaFileId`)
      const schemasByFileId = await db
        .select()
        .from(schemas)
        .where(eq(schemas.schemaFileId, schemaName))
        .orderBy(desc(schemas.isDraft), desc(schemas.version))
        .limit(1)
      
      if (schemasByFileId.length > 0) {
        logger(`Found schema by schemaFileId "${schemaName}" (name in DB: ${schemasByFileId[0].name})`)
        dbSchemas = schemasByFileId
      }
    }

    // Try to find by schemaFileId from file
    const shouldTrySchemaFileId = dbSchemas.length === 0 || (dbSchemas.length > 0 && dbSchemas[0].isDraft === false)
    
    if (shouldTrySchemaFileId) {
      const completeSchemas = await listCompleteSchemaFiles()
      const matchingFileSchemas = completeSchemas.filter((s) => s.name === schemaName)
      
      if (matchingFileSchemas.length > 0) {
        const latestFile = matchingFileSchemas.reduce((prev, current) =>
          current.version > prev.version ? current : prev,
        )
        
        try {
          const content = await BaseFileManager.readFileAsString(latestFile.filePath)
          const fileSchema = JSON.parse(content) as SchemaFileFormat
          
          if (fileSchema.id) {
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
              logger(`Found DRAFT by schemaFileId ${fileSchema.id}`)
              dbSchemas = draftsByFileId
            } else {
              const dbSchemasByFileId = await db
                .select()
                .from(schemas)
                .where(eq(schemas.schemaFileId, fileSchema.id))
                .orderBy(desc(schemas.isDraft), desc(schemas.version))
                .limit(1)
              
              if (dbSchemasByFileId.length > 0) {
                const foundSchema = dbSchemasByFileId[0]
                if (foundSchema.isDraft === true || dbSchemas.length === 0) {
                  dbSchemas = dbSchemasByFileId
                }
              }
            }
          }
        } catch (error) {
          logger(`Error reading file to get schemaFileId: ${error}`)
        }
      }
      
      // Check all drafts for normalized name match
      if (dbSchemas.length === 0) {
        const allDrafts = await db
          .select()
          .from(schemas)
          .where(eq(schemas.isDraft, true))
          .orderBy(desc(schemas.version))
        
        const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const normalizedRequested = normalizeName(schemaName)
        
        for (const draft of allDrafts) {
          if (draft.schemaData) {
            try {
              const draftSchema = JSON.parse(draft.schemaData) as SchemaFileFormat
              const draftMetadataName = draftSchema.metadata?.name || ''
              const draftDbName = draft.name || ''
              
              const normalizedDraftMetadata = normalizeName(draftMetadataName)
              const normalizedDraftDb = normalizeName(draftDbName)
              
              if (normalizedDraftMetadata === normalizedRequested || normalizedDraftDb === normalizedRequested) {
                dbSchemas = [draft]
                break
              }
            } catch (error) {
              continue
            }
          }
        }
      }
    }

    // If schema found in database, return it
    if (dbSchemas.length > 0) {
      const dbSchema = dbSchemas[0]
      logger(`Found schema record: name="${dbSchema.name}", isDraft=${dbSchema.isDraft}`)

      // Load schema from schemaData or file
      let schemaFile: SchemaFileFormat | null = null
      
      if (dbSchema.isDraft === true && dbSchema.schemaData) {
        try {
          schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
          
          // Ensure schema.id matches schemaFileId from database
          if (dbSchema.schemaFileId && schemaFile.id !== dbSchema.schemaFileId) {
            schemaFile.id = dbSchema.schemaFileId
          } else if (!schemaFile.id && dbSchema.schemaFileId) {
            schemaFile.id = dbSchema.schemaFileId
          }
          
          // Merge models from database
          if (dbSchema.id) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              let mergedModels = { ...(schemaFile.models || {}) }
              mergedModels = { ...mergedModels, ...dbModels }
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  mergedModels[modelName] = {
                    ...mergedModels[modelName],
                    properties: {
                      ...mergedModels[modelName].properties,
                      ...dbModel.properties,
                    },
                  }
                }
              }
              schemaFile.models = mergedModels
            }
          }
        } catch (error) {
          logger(`Error parsing schemaData: ${error}`)
        }
      } else if (dbSchema.schemaFileId) {
        // Try to load from file
        try {
          const completeSchemas = await listCompleteSchemaFiles()
          const idBasedMatch = completeSchemas.find((s) => s.schemaFileId === dbSchema.schemaFileId)
          
          if (idBasedMatch) {
            const content = await BaseFileManager.readFileAsString(idBasedMatch.filePath)
            schemaFile = JSON.parse(content) as SchemaFileFormat
          } else {
            const filePath = getSchemaFilePath(dbSchema.name, dbSchema.version, dbSchema.schemaFileId)
            try {
              const content = await BaseFileManager.readFileAsString(filePath)
              schemaFile = JSON.parse(content) as SchemaFileFormat
            } catch {
              // File doesn't exist
            }
          }
          
          // Ensure schema.id matches schemaFileId from database (database is source of truth)
          if (schemaFile && dbSchema.schemaFileId) {
            if (schemaFile.id !== dbSchema.schemaFileId) {
              logger(`Fixing schema ID mismatch: file has id="${schemaFile.id}", DB has schemaFileId="${dbSchema.schemaFileId}". Using DB value.`)
              schemaFile.id = dbSchema.schemaFileId
            } else if (!schemaFile.id && dbSchema.schemaFileId) {
              logger(`Schema missing id, using schemaFileId from database: "${dbSchema.schemaFileId}"`)
              schemaFile.id = dbSchema.schemaFileId
            }
          }
          
          if (schemaFile && dbSchema.id) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              let mergedModels = { ...(schemaFile.models || {}) }
              mergedModels = { ...mergedModels, ...dbModels }
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  mergedModels[modelName] = {
                    ...mergedModels[modelName],
                    properties: {
                      ...mergedModels[modelName].properties,
                      ...dbModel.properties,
                    },
                  }
                }
              }
              schemaFile.models = mergedModels
            }
          }
        } catch (error) {
          logger(`Error loading from file: ${error}`)
        }
      }

      if (schemaFile) {
        // Query model IDs and create instances
        let modelIds: string[] = []
        if (dbSchema.id) {
          modelIds = await getModelIdsForSchema(dbSchema.id)
          await createModelInstances(modelIds)
        }
        
        const loadedAt = Date.now()
        const dbVersion = dbSchema.version || schemaFile.version
        const dbUpdatedAt = dbSchema.updatedAt || loadedAt
        
        sendBack({
          type: 'schemaFound',
          schema: schemaFile,
          schemaRecord: dbSchema,
          modelIds,
          loadedAt,
          dbVersion,
          dbUpdatedAt,
        })
        return
      }
    }

    // Check for existing schema files (backward compatibility)
    const completeSchemas = await listCompleteSchemaFiles()
    const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)

    if (matchingSchemas.length > 0) {
      // Check for matching draft in database
      const allDrafts = await db
        .select()
        .from(schemas)
        .where(eq(schemas.isDraft, true))
        .orderBy(desc(schemas.version))
      
      const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const normalizedRequested = normalizeName(schemaName)
      
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
              break
            }
          } catch (error) {
            continue
          }
        }
      }
      
      if (matchingDraft && matchingDraft.schemaData) {
        try {
          const schemaFile = JSON.parse(matchingDraft.schemaData) as SchemaFileFormat
          let modelIds: string[] = []
          if (matchingDraft.id) {
            modelIds = await getModelIdsForSchema(matchingDraft.id)
            await createModelInstances(modelIds)
          }
          
          const loadedAt = Date.now()
          const dbVersion = matchingDraft.version || schemaFile.version
          const dbUpdatedAt = matchingDraft.updatedAt || loadedAt
          
          sendBack({
            type: 'schemaFound',
            schema: schemaFile,
            schemaRecord: matchingDraft,
            modelIds,
            loadedAt,
            dbVersion,
            dbUpdatedAt,
          })
          return
        } catch (error) {
          logger(`Error parsing draft schemaData: ${error}`)
        }
      }
      
      // Load from file
      const latest = matchingSchemas.reduce((prev, current) =>
        current.version > prev.version ? current : prev,
      )

      const content = await BaseFileManager.readFileAsString(latest.filePath)
      const schemaFile = JSON.parse(content) as SchemaFileFormat

      // Query model IDs if schema exists in DB
      let modelIds: string[] = []
      try {
        if (db && schemaFile.id) {
          const schemaRecords = await db
            .select()
            .from(schemas)
            .where(eq(schemas.schemaFileId, schemaFile.id))
            .limit(1)
          
          if (schemaRecords.length > 0 && schemaRecords[0].id) {
            modelIds = await getModelIdsForSchema(schemaRecords[0].id)
            await createModelInstances(modelIds)
          }
        }
      } catch (error) {
        logger(`Error querying model IDs for schema from file: ${error}`)
      }
      
      const loadedAt = Date.now()
      const dbVersion = schemaFile.version
      const dbUpdatedAt = new Date(schemaFile.metadata.updatedAt).getTime() || loadedAt
      
      sendBack({
        type: 'schemaFound',
        schema: schemaFile,
        schemaRecord: null,
        modelIds,
        loadedAt,
        dbVersion,
        dbUpdatedAt,
      })
      return
    }

    // No schema found
    sendBack({
      type: 'schemaNotFound',
    })
  }

  _check().catch((error) => {
    logger('Error in checkExistingSchema:', error)
    sendBack({
      type: 'schemaNotFound',
    })
  })

  return () => {
    // Cleanup function (optional)
  }
})
