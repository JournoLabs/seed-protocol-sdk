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
    const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
    
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
    const { modelName, schemaName, _modelFileId } = context

    console.log('loadOrCreateModel called for', modelName, 'with schemaName', schemaName, 'and _modelFileId', _modelFileId)

    if (!modelName || !schemaName) {
      throw new Error('Model name and schema name are required')
    }

    // CRITICAL: Model instances load their data from database, not from Schema context.
    // Schema is read-only with respect to Model instances.

    const db = BaseDb.getAppDb()
    let modelFileId = _modelFileId
    let modelRecord: any = null

    console.log('has db', !!db)

    // Step 1: Load from database FIRST (primary source of truth)
    if (db) {
      try {
        // Try to find model by modelFileId if provided
        if (modelFileId) {
          const dbModels = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.schemaFileId, modelFileId))
            .limit(1)
          
          if (dbModels.length > 0) {
            modelRecord = dbModels[0]
            logger(`Found model "${modelName}" in database by modelFileId "${modelFileId}"`)
          }
        }
        
        console.log('modelRecord', modelRecord)

        // If not found by ID, try by name
        if (!modelRecord) {
          const dbModels = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, modelName))
            .limit(1)

          console.log('dbModels.length', dbModels.length)
          
          if (dbModels.length > 0) {
            modelRecord = dbModels[0]
            const dbSchemaFileId = modelRecord.schemaFileId
            // Only use database schemaFileId if no modelFileId was explicitly provided
            // If a modelFileId was provided, we should use it (it might be creating a new model with a specific ID)
            if (!_modelFileId && dbSchemaFileId) {
              modelFileId = dbSchemaFileId
              logger(`Using database schemaFileId "${modelFileId}" for model "${modelName}" (no ID was provided)`)
            } else if (_modelFileId) {
              logger(`Preserving provided modelFileId "${modelFileId}" for model "${modelName}" (ignoring database schemaFileId "${dbSchemaFileId}")`)
            }
            logger(`Found model "${modelName}" in database by name, modelFileId: "${modelFileId}"`)
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
            .map(record => record.schemaFileId)
            .filter((id): id is string => id !== null)

          if (propertyFileIds.length > 0) {
            await createPropertyInstances(propertyFileIds)
          }

          // Generate modelFileId if not set
          if (!modelFileId) {
            modelFileId = generateId()
            logger(`Generated modelFileId "${modelFileId}" for model "${modelName}"`)
          }

          // Include modelId from database record so properties can be created if needed
          // Even if we found an existing model, we may still need to create properties
          // if _pendingPropertyDefinitions are provided
          
          // Track conflict detection metadata
          const loadedAt = Date.now()
          // Note: models table doesn't have updatedAt or version, so we use loadedAt for _dbUpdatedAt
          // In the future, if models table gets these fields, we should use them
          const dbUpdatedAt = loadedAt
          
          sendBack({
            type: 'loadOrCreateModelSuccess',
            model: {
              _modelFileId: modelFileId,
              modelId: modelRecord.id, // Include database ID for property creation
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
      if (schemaSnapshot.value === 'loading') {
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
        
        // Generate modelFileId if not set
        if (!modelFileId) {
          modelFileId = generateId()
          logger(`Generated modelFileId "${modelFileId}" for model "${modelName}"`)
        }
        
        sendBack({
          type: 'loadOrCreateModelSuccess',
          model: {
            _modelFileId: modelFileId,
          },
        })
        return
      }
    } catch (error) {
      logger(`Error loading model from Schema context: ${error}`)
      // Fall through to create new model
    }

    // Step 3: Check for duplicate names in database before creating new model
    let finalModelName = modelName
    if (db) {
      try {
        const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
        const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
        
        // Query all models for this schema to check for duplicates (case-insensitive)
        const allModelsForSchema = await db
          .select({
            name: modelsTable.name,
          })
          .from(modelsTable)
          .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
          .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
          .where(eq(schemasTable.name, schemaName))
        
        const lowerModelName = modelName.toLowerCase()
        const existingNumbers = new Set<number>()
        
        // Check for exact match (case-insensitive) or matches with number suffix
        for (const dbModel of allModelsForSchema) {
          const lowerDbName = dbModel.name.toLowerCase()
          if (lowerDbName === lowerModelName) {
            existingNumbers.add(0) // Base name exists
          } else if (lowerDbName.startsWith(lowerModelName + ' ')) {
            // Check if it's the base name followed by a space and a number
            const suffix = lowerDbName.slice(lowerModelName.length + 1)
            const number = parseInt(suffix, 10)
            if (!isNaN(number) && suffix === number.toString()) {
              existingNumbers.add(number)
            }
          }
        }
        
        // If duplicates found, generate unique name
        if (existingNumbers.has(0)) {
          let nextNumber = 1
          while (existingNumbers.has(nextNumber)) {
            nextNumber++
          }
          finalModelName = `${modelName} ${nextNumber}`
          logger(`Found duplicate model name "${modelName}" in schema "${schemaName}", using unique name "${finalModelName}"`)
        }
      } catch (error) {
        logger(`Error checking for duplicate model names: ${error}`)
        // Continue with original name if check fails
      }
    }
    
    // Step 4: Create new empty model (not found in database or Schema context)
    logger(`Creating new model "${finalModelName}" in schema "${schemaName}"`)
    
    // Generate modelFileId for new model
    if (!modelFileId) {
      modelFileId = generateId()
      logger(`Generated modelFileId "${modelFileId}" for new model "${finalModelName}"`)
    }
    
    sendBack({
      type: 'loadOrCreateModelSuccess',
      model: {
        _modelFileId: modelFileId,
      },
    })
    
    // Update modelName in context and cache if it was changed (send after success event)
    if (finalModelName !== modelName) {
      // Update the cache index
      const { Model } = await import('@/Model/Model')
      Model.updateNameIndex(modelName, finalModelName, schemaName, modelFileId)
      
      // Update the context
      sendBack({
        type: 'updateContext',
        modelName: finalModelName,
      })
    }
  }

  _loadOrCreateModel().catch((error) => {
    logger('Error loading or creating model:', error)
    sendBack({ type: 'loadOrCreateModelError', error })
  })

  return () => {
    // Cleanup function (optional)
  }
})

