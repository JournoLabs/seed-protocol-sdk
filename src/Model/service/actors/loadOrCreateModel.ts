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

export const loadOrCreateModel = fromCallback<
  EventObject,
  FromCallbackInput<ModelMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateModel = async (): Promise<void> => {
    const { modelName, schemaName, _modelFileId } = context

    if (!modelName || !schemaName) {
      throw new Error('Model name and schema name are required')
    }

    // CRITICAL: Model instances load their data from database, not from Schema context.
    // Schema is read-only with respect to Model instances.

    const db = BaseDb.getAppDb()
    let modelFileId = _modelFileId
    let modelRecord: any = null

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
        
        // If not found by ID, try by name
        if (!modelRecord) {
          const dbModels = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, modelName))
            .limit(1)
          
          if (dbModels.length > 0) {
            modelRecord = dbModels[0]
            modelFileId = modelRecord.schemaFileId || modelFileId
            logger(`Found model "${modelName}" in database by name, modelFileId: "${modelFileId}"`)
          }
        }

        // If we found the model record, load its properties from database
        if (modelRecord && modelRecord.id) {
          const propertyRecords = await db
            .select()
            .from(propertiesTable)
            .where(eq(propertiesTable.modelId, modelRecord.id))

          // Reconstruct properties object from database
          const modelProperties: { [propertyName: string]: any } = {}
          
          for (const prop of propertyRecords) {
            const propertyData: any = {
              dataType: prop.dataType,
            }

            // Add ref information if it's a relation
            if (prop.refModelId) {
              // Get the referenced model name
              const refModelRecords = await db
                .select({ name: modelsTable.name })
                .from(modelsTable)
                .where(eq(modelsTable.id, prop.refModelId))
                .limit(1)
              
              if (refModelRecords.length > 0) {
                propertyData.ref = refModelRecords[0].name
              }
            }

            if (prop.refValueType) {
              propertyData.refValueType = prop.refValueType
            }

            modelProperties[prop.name] = propertyData
          }

          // Generate modelFileId if not set
          if (!modelFileId) {
            modelFileId = generateId()
            logger(`Generated modelFileId "${modelFileId}" for model "${modelName}"`)
          }

          // Load description and indexes from Schema context as fallback
          // (These aren't stored in database tables yet)
          let description: string | undefined = undefined
          let indexes: string[] | undefined = undefined
          
          try {
            const { Schema } = await import('@/Schema/Schema')
            const schema = Schema.create(schemaName)
            const schemaSnapshot = schema.getService().getSnapshot()
            
            if (schemaSnapshot.value === 'idle') {
              const schemaContext = schemaSnapshot.context
              if (schemaContext.models && schemaContext.models[modelName]) {
                const modelData = schemaContext.models[modelName]
                description = modelData.description
                indexes = modelData.indexes
              }
            }
          } catch (error) {
            logger(`Error loading description/indexes from Schema context: ${error}`)
          }

          sendBack({
            type: 'loadOrCreateModelSuccess',
            model: {
              description,
              properties: modelProperties,
              indexes,
              _modelFileId: modelFileId,
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
            description: modelData.description,
            properties: modelData.properties || {},
            indexes: modelData.indexes,
            _modelFileId: modelFileId,
          },
        })
        return
      }
    } catch (error) {
      logger(`Error loading model from Schema context: ${error}`)
      // Fall through to create new model
    }

    // Step 3: Create new empty model (not found in database or Schema context)
    logger(`Creating new model "${modelName}" in schema "${schemaName}"`)
    
    // Generate modelFileId for new model
    if (!modelFileId) {
      modelFileId = generateId()
      logger(`Generated modelFileId "${modelFileId}" for new model "${modelName}"`)
    }
    
    sendBack({
      type: 'loadOrCreateModelSuccess',
      model: {
        description: undefined,
        properties: {},
        indexes: undefined,
        _modelFileId: modelFileId,
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

