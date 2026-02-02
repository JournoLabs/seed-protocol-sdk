import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelMachineContext } from '../modelMachine'
// Dynamic import to break circular dependency: Model.ts -> modelMachine -> loadOrCreateModel -> Schema.ts -> Model.ts
// import { Schema } from '@/Schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { eq, and } from 'drizzle-orm'
import { generateId } from '@/helpers'
import debug from 'debug'

const logger = debug('seedSdk:model:actors:loadOrCreateModel')

/**
 * Create ModelProperty instances for all property IDs to ensure they're cached
 * This ensures that ModelProperty.getById() in Model.properties getter will find the instances
 * @param propertyFileIds - Array of property file IDs to create instances for
 */
const createPropertyInstances = async (propertyFileIds: string[]): Promise<void> => {
  if (propertyFileIds.length === 0) {
    return
  }

  try {
    const mod = await import('@/ModelProperty/ModelProperty')
    const ModelProperty = mod?.ModelProperty ?? (mod as { default?: unknown })?.default
    if (!ModelProperty) {
      logger('createPropertyInstances: ModelProperty not available from dynamic import')
      return
    }

    // Create instances for all property IDs in parallel
    // ModelProperty.createById() will check cache first, then query DB and create if needed
    const createPromises = propertyFileIds.map(async (propertyFileId) => {
      try {
        const property = await ModelProperty.createById(propertyFileId)
        if (property) {
          logger(`Created/cached ModelProperty instance for propertyFileId "${propertyFileId}"`)
        } else {
          logger(`ModelProperty.createById returned undefined for propertyFileId "${propertyFileId}" (may not exist in DB yet)`)
        }
      } catch (error) {
        logger(`Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
        // Don't throw - continue with other properties
      }
    })
    
    await Promise.all(createPromises)
    logger(`Finished creating/caching ${propertyFileIds.length} ModelProperty instances`)
  } catch (error) {
    logger(`Error in createPropertyInstances: ${error}`)
    // Don't throw - this is best-effort to pre-populate cache
  }
}

export const loadOrCreateModel = fromCallback<
  EventObject,
  FromCallbackInput<ModelMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateModel = async (): Promise<void> => {
    const { modelName, schemaName, id } = context // id is now the schemaFileId (string)

    console.log('loadOrCreateModel called for', modelName, 'with schemaName', schemaName, 'and id', id)

    if (!modelName || !schemaName) {
      throw new Error('Model name and schema name are required')
    }

    // CRITICAL: Model instances load their data from database, not from Schema context.
    // Schema is read-only with respect to Model instances.

    const db = BaseDb.getAppDb()
    let schemaFileId = id // id is now the schemaFileId (string)
    let modelRecord: any = null
    let foundBySchemaFileId = false // Track if model was found by schemaFileId

    console.log('has db', !!db)

    // Step 1: Load from database FIRST (primary source of truth)
    if (db) {
      try {
        // Try to find model by schemaFileId if provided
        if (schemaFileId) {
          const dbModels = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.schemaFileId, schemaFileId))
            .limit(1)
          
          if (dbModels.length > 0) {
            modelRecord = dbModels[0]
            foundBySchemaFileId = true
            logger(`Found model "${modelName}" in database by schemaFileId "${schemaFileId}"`)
          }
        }
        
        console.log('modelRecord', modelRecord)

        // If not found by ID, try by name
        // But if we have a schemaFileId and the model found by name has a different schemaFileId,
        // don't use it - we're creating a new model from a schema file with a specific ID
        if (!modelRecord) {
          const dbModels = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, modelName))
            .limit(1)

          console.log('dbModels.length', dbModels.length)
          
          if (dbModels.length > 0) {
            const foundModel = dbModels[0]
            const dbSchemaFileId = foundModel.schemaFileId
            
            // CRITICAL: If we found a model in the database by name, check if there's already a cached instance
            // with that schemaFileId. If so, we should use that instance's schemaFileId for the current instance.
            // This handles the case where Model.create was called with a generated ID, but the model
            // already exists in the database with a different ID. By updating the current instance's
            // schemaFileId to match the database, both will point to the same cached instance.
            if (dbSchemaFileId) {
              try {
                const { Model } = await import('@/Model/Model')
                // Access instanceCacheById via type assertion since it's protected
                const cacheById = (Model as any).instanceCacheById as Map<string, any>
                if (cacheById.has(dbSchemaFileId)) {
                  logger(`Model "${modelName}" found in database by name with schemaFileId "${dbSchemaFileId}", and a cached instance already exists. Updating current instance to use the same schemaFileId.`)
                  // Update the current instance's schemaFileId to match the database
                  // This ensures both instances point to the same cached instance
                  modelRecord = foundModel
                  schemaFileId = dbSchemaFileId
                  logger(`Using existing cached instance with schemaFileId "${schemaFileId}" for model "${modelName}"`)
                }
              } catch (error) {
                logger(`Error checking Model cache for schemaFileId "${dbSchemaFileId}": ${error}`)
                // Fall through to normal processing
              }
            }
            
            // If we have a schemaFileId and it doesn't match the found model's schemaFileId,
            // this is a new model - don't use the existing model (will be renamed if duplicate)
            // UNLESS we found a cached instance above (in which case modelRecord is already set)
            if (!modelRecord && schemaFileId && dbSchemaFileId && schemaFileId !== dbSchemaFileId) {
              logger(`Model "${modelName}" found by name but has different schemaFileId (provided: "${schemaFileId}", db: "${dbSchemaFileId}"). Creating new model (will check for duplicates).`)
              // Don't set modelRecord - we'll create a new model with potentially renamed name
            } else if (!modelRecord && schemaFileId && !dbSchemaFileId) {
              // We have a schemaFileId but the found model doesn't have one - this is a new model
              // Don't reuse the existing model, create a new one (will be renamed if duplicate)
              logger(`Model "${modelName}" found by name but found model has no schemaFileId. Creating new model with schemaFileId "${schemaFileId}" (will check for duplicates).`)
              // Don't set modelRecord - we'll create a new model
            } else if (!modelRecord) {
              // Only reuse existing model if:
              // 1. No schemaFileId was provided (loading existing model), OR
              // 2. schemaFileId matches (same model)
              logger(`Model "${modelName}" found by name, reusing existing model (schemaFileId: provided="${schemaFileId}", db="${dbSchemaFileId}")`)
              modelRecord = foundModel
              // Only use database schemaFileId if no id was explicitly provided
              // If an id was provided, we should use it (it might be creating a new model with a specific ID)
              if (!id && dbSchemaFileId) {
                schemaFileId = dbSchemaFileId
                logger(`Using database schemaFileId "${schemaFileId}" for model "${modelName}" (no ID was provided)`)
              } else if (id) {
                logger(`Preserving provided id (schemaFileId) "${schemaFileId}" for model "${modelName}" (ignoring database schemaFileId "${dbSchemaFileId}")`)
              }
              logger(`Found model "${modelName}" in database by name, schemaFileId: "${schemaFileId}"`)
            }
          }
        }

        // If we found the model record, load its properties from database
        if (modelRecord && modelRecord.id) {
          const propertyRecords = await db
            .select()
            .from(propertiesTable)
            .where(eq(propertiesTable.modelId, modelRecord.id))

          console.log('propertyRecords.length', propertyRecords.length)

          // Properties are now loaded via liveQuery, not passed through context
          // The property records are used by liveQuery to populate ModelProperty instances

          // Pre-create ModelProperty instances for all property IDs to ensure they're cached
          // This ensures that ModelProperty.getById() in Model.properties getter will find the instances
          const propertyFileIds = propertyRecords
            .map((record: { schemaFileId: string | null }) => record.schemaFileId)
            .filter((id: string | null | undefined): id is string => id !== null && id !== undefined)

          if (propertyFileIds.length > 0) {
            await createPropertyInstances(propertyFileIds)
          }

          // Generate schemaFileId if not set
          if (!schemaFileId) {
            schemaFileId = generateId()
            logger(`Generated id (schemaFileId) "${schemaFileId}" for model "${modelName}"`)
          }

          // Include _dbId from database record so properties can be created if needed
          // Even if we found an existing model, we may still need to create properties
          // if _pendingPropertyDefinitions are provided
          
          // Track conflict detection metadata
          const loadedAt = Date.now()
          // Note: models table doesn't have updatedAt or version, so we use loadedAt for _dbUpdatedAt
          // In the future, if models table gets these fields, we should use them
          const dbUpdatedAt = loadedAt
          
          // CRITICAL: Include _liveQueryPropertyIds in loadOrCreateModelSuccess event
          // This ensures the properties getter works immediately, even before _setupLiveQuerySubscription runs
          // We already have the property IDs from the database query, so include them now
          sendBack({
            type: 'loadOrCreateModelSuccess',
            model: {
              id: schemaFileId, // schemaFileId (string) - public ID
              _dbId: modelRecord.id, // Database integer ID - internal only
              _liveQueryPropertyIds: propertyFileIds, // Property IDs from database query
              _propertiesUpdated: Date.now(), // Timestamp for tracking
              _isEdited: modelRecord.isEdited ?? false, // Load isEdited from database
              _loadedAt: loadedAt,
              _dbUpdatedAt: dbUpdatedAt,
            },
          })
          return
        }
      } catch (error) {
        logger(`Error loading model from database: ${error}`)
        // Fall through to create new model
      }
    }

    // Step 2: Fallback to Schema context (only if database doesn't have the model)
    // This handles the case where model exists in schema file but not yet in database
    try {
      const { Schema } = await import('@/Schema/Schema')
      const schema = Schema.create(schemaName)
      const schemaSnapshot = schema.getService().getSnapshot()
      
      // Wait for schema to load if it's still loading
      // Check if state is a loading state object (XState v5 nested states)
      const isLoading = typeof schemaSnapshot.value === 'object' && 'loading' in schemaSnapshot.value
      if (isLoading) {
        await new Promise<void>((resolve, reject) => {
          const subscription = schema.getService().subscribe((snapshot) => {
            if (snapshot.value === 'idle' || snapshot.value === 'error') {
              subscription.unsubscribe()
              if (snapshot.value === 'error') {
                reject(new Error('Schema failed to load'))
              } else {
                resolve()
              }
            }
          })
        })
      }

      const schemaContext = schema.getService().getSnapshot().context
      
      if (schemaContext.models && schemaContext.models[modelName]) {
        const modelData = schemaContext.models[modelName]
        logger(`Found model "${modelName}" in Schema context (database fallback)`)
        
        // Generate schemaFileId if not set
        if (!schemaFileId) {
          schemaFileId = generateId()
          logger(`Generated id (schemaFileId) "${schemaFileId}" for model "${modelName}"`)
        }
        
        sendBack({
          type: 'loadOrCreateModelSuccess',
          model: {
            id: schemaFileId, // schemaFileId (string) - public ID
          },
        })
        return
      }
    } catch (error) {
      logger(`Error loading model from Schema context: ${error}`)
      // Fall through to create new model
    }

    // Step 3: Check for duplicate names in database before creating new model
    // Skip duplicate check only if we found a model record to use (modelRecord is set)
    // OR if the model was found by schemaFileId (preserving original name from schema file)
    // OR if this is an internal schema (Seed Protocol) - internal schemas should preserve original names
    // Otherwise, check for duplicates when creating a new model
    // NOTE: We should NOT skip duplicate check just because schemaFileId exists - that could be a newly generated ID
    // for a new model that needs to be renamed if it's a duplicate
    let finalModelName = modelName
    if (db) {
      // Check if this is an internal schema (Seed Protocol)
      const { isInternalSchema } = await import('@/helpers/constants')
      const isInternal = isInternalSchema(schemaName)
      
      // Only skip duplicate check if:
      // 1. We found a model record to use (modelRecord is set), OR
      // 2. The model was found by schemaFileId (preserving original name from schema file), OR
      // 3. This is an internal schema (internal schemas should preserve original names from schema files)
      // We should NOT skip if we only have a schemaFileId but didn't find the model by that ID
      // (that means it's a new model that might need renaming)
      const shouldSkipDuplicateCheck = modelRecord !== null || foundBySchemaFileId || isInternal
      
      logger(`Duplicate check: modelRecord=${modelRecord !== null}, foundBySchemaFileId=${foundBySchemaFileId}, isInternal=${isInternal}, schemaFileId=${schemaFileId}, shouldSkip=${shouldSkipDuplicateCheck}`)
      
      if (!shouldSkipDuplicateCheck) {
        try {
          const lowerModelName = modelName.toLowerCase()
          const existingNumbers = new Set<number>()
          
          // First, check Model cache for models (includes models from imported schemas that may not be in DB yet)
          try {
            const { Model } = await import('@/Model/Model')
            
            // Check name-based cache for this schema
            logger(`Checking Model cache for duplicates in schema "${schemaName}"`)
            // Access instanceCacheByName via type assertion since it's protected
            const cacheByName = (Model as any).instanceCacheByName as Map<string, string>
            for (const [nameKey, modelFileId] of cacheByName.entries()) {
              const [cachedSchemaName, cachedModelName] = nameKey.split(':', 2)
              if (cachedSchemaName === schemaName && cachedModelName) {
                const lowerCachedName = cachedModelName.toLowerCase()
                if (lowerCachedName === lowerModelName) {
                  existingNumbers.add(0) // Base name exists
                  logger(`Found duplicate in Model cache: "${cachedModelName}" matches "${modelName}"`)
                } else if (lowerCachedName.startsWith(lowerModelName + ' ')) {
                  // Check if it's the base name followed by a space and a number
                  const suffix = lowerCachedName.slice(lowerModelName.length + 1)
                  const number = parseInt(suffix, 10)
                  if (!isNaN(number) && suffix === number.toString()) {
                    existingNumbers.add(number)
                    logger(`Found numbered variant in Model cache: "${cachedModelName}" (number: ${number})`)
                  }
                }
              }
            }
            
            // Also check legacy cache
            for (const [nameKey] of (Model as any).instanceCache?.keys() || []) {
              const [cachedSchemaName, cachedModelName] = nameKey.split(':', 2)
              if (cachedSchemaName === schemaName && cachedModelName) {
                const lowerCachedName = cachedModelName.toLowerCase()
                if (lowerCachedName === lowerModelName) {
                  existingNumbers.add(0) // Base name exists
                  logger(`Found duplicate in Model legacy cache: "${cachedModelName}" matches "${modelName}"`)
                } else if (lowerCachedName.startsWith(lowerModelName + ' ')) {
                  // Check if it's the base name followed by a space and a number
                  const suffix = lowerCachedName.slice(lowerModelName.length + 1)
                  const number = parseInt(suffix, 10)
                  if (!isNaN(number) && suffix === number.toString()) {
                    existingNumbers.add(number)
                    logger(`Found numbered variant in Model legacy cache: "${cachedModelName}" (number: ${number})`)
                  }
                }
              }
            }
          } catch (error) {
            logger(`Error checking Model cache for duplicates: ${error}`)
            // Continue with database check
          }
          
          // Also check database for models (in case they're persisted but not in Schema context)
          if (db) {
            const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
            const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
            
            // Query all models for this schema to check for duplicates (case-insensitive)
            logger(`Checking database for duplicate model names in schema "${schemaName}"`)
            const allModelsForSchema = await db
              .select({
                name: modelsTable.name,
              })
              .from(modelsTable)
              .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
              .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
              .where(eq(schemasTable.name, schemaName))
            
            logger(`Found ${allModelsForSchema.length} models in database for schema "${schemaName}": ${allModelsForSchema.map((m: { name: string | null }) => m.name).join(', ')}`)
            if (allModelsForSchema.length === 0 && modelName.includes('Shared')) {
              logger(`[DEBUG] No models found in database for schema "${schemaName}" when checking for duplicate "${modelName}"`)
            }
            
            // Check for exact match (case-insensitive) or matches with number suffix
            for (const dbModel of allModelsForSchema) {
              const lowerDbName = dbModel.name.toLowerCase()
              if (lowerDbName === lowerModelName) {
                existingNumbers.add(0) // Base name exists
                logger(`Found duplicate in database: "${dbModel.name}" matches "${modelName}"`)
              } else if (lowerDbName.startsWith(lowerModelName + ' ')) {
                // Check if it's the base name followed by a space and a number
                const suffix = lowerDbName.slice(lowerModelName.length + 1)
                const number = parseInt(suffix, 10)
                if (!isNaN(number) && suffix === number.toString()) {
                  existingNumbers.add(number)
                  logger(`Found numbered variant in database: "${dbModel.name}" (number: ${number})`)
                }
              }
            }
          }
          
          // If duplicates found, generate unique name
          logger(`Duplicate check results: existingNumbers=${Array.from(existingNumbers).join(', ')}, hasBaseName=${existingNumbers.has(0)}`)
          if (existingNumbers.has(0)) {
            let nextNumber = 1
            while (existingNumbers.has(nextNumber)) {
              nextNumber++
            }
            finalModelName = `${modelName} ${nextNumber}`
            logger(`Found duplicate model name "${modelName}" in schema "${schemaName}", using unique name "${finalModelName}"`)
          } else {
            logger(`No duplicate found for model name "${modelName}" in schema "${schemaName}"`)
          }
        } catch (error) {
          logger(`Error checking for duplicate model names: ${error}`)
          // Continue with original name if check fails
        }
      } else {
        if (foundBySchemaFileId) {
          logger(`Preserving original model name "${modelName}" for model found by schemaFileId (schemaFileId: ${schemaFileId})`)
        } else if (modelRecord) {
          logger(`Using existing model name "${modelName}" from database (modelRecord found)`)
        } else if (isInternal) {
          logger(`Preserving original model name "${modelName}" for internal schema "${schemaName}" (skipping duplicate check)`)
        }
      }
    }
    
    // Step 4: Create new empty model (not found in database or Schema context)
    logger(`Creating new model "${finalModelName}" in schema "${schemaName}"`)
    
    // Generate schemaFileId for new model
    if (!schemaFileId) {
      schemaFileId = generateId()
      logger(`Generated id (schemaFileId) "${schemaFileId}" for new model "${finalModelName}"`)
    }
    
    // If model name was changed, store it in a temporary internal field so loadOrCreateModelSuccess can apply it
    // This avoids the issue where updateContext with modelName triggers validation and state transition
    // We use _pendingModelName (internal field) which won't trigger validation
    if (finalModelName !== modelName) {
      logger(`Model name changed from "${modelName}" to "${finalModelName}", storing in _pendingModelName for loadOrCreateModelSuccess`)
      // Update the cache index
      const { Model } = await import('@/Model/Model')
      Model.updateNameIndex(modelName, finalModelName, schemaName, schemaFileId)
      
      // Store the final name in a temporary internal field that will be picked up by loadOrCreateModelSuccess
      // Using internal field (_pendingModelName) avoids triggering validation
      sendBack({
        type: 'updateContext',
        _pendingModelName: finalModelName,
      })
    } else {
      logger(`Model name unchanged: "${modelName}"`)
    }
    
    sendBack({
      type: 'loadOrCreateModelSuccess',
      model: {
        id: schemaFileId, // schemaFileId (string) - public ID
      },
    })
  }

  _loadOrCreateModel().catch((error) => {
    logger('Error loading or creating model:', error)
    sendBack({ type: 'loadOrCreateModelError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})

