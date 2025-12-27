import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { ModelMachineContext } from '../modelMachine'
// Dynamic import to break circular dependency: Model.ts -> modelMachine -> loadOrCreateModel -> Schema.ts -> Model.ts
// import { Schema } from '@/schema/Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { eq } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:model:actors:loadOrCreateModel')

export const loadOrCreateModel = fromCallback<
  EventObject,
  FromCallbackInput<ModelMachineContext>
>(({ sendBack, input: { context } }) => {
  const _loadOrCreateModel = async (): Promise<void> => {
    const { modelName, schemaName } = context

    if (!modelName || !schemaName) {
      throw new Error('Model name and schema name are required')
    }

    // First, try to load from Schema context (most reliable source)
    try {
      // Use dynamic import to break circular dependency
      const { Schema } = await import('@/schema/Schema')
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
        logger(`Found model ${modelName} in schema ${schemaName}`)
        
        sendBack({
          type: 'loadOrCreateModelSuccess',
          model: {
            description: modelData.description,
            properties: modelData.properties || {},
            indexes: modelData.indexes,
            _modelFileId: undefined, // Will be set from schema file if available
          },
        })
        return
      }
    } catch (error) {
      logger(`Error loading model from schema: ${error}`)
      // Fall through to database lookup
    }

    // Fallback: Try to load from database
    const db = BaseDb.getAppDb()
    if (db) {
      try {
        // Find model by name (we'd need schema relationship, but for now just by name)
        const dbModels = await db
          .select()
          .from(modelsTable)
          .where(eq(modelsTable.name, modelName))
          .limit(1)

        if (dbModels.length > 0) {
          const dbModel = dbModels[0]
          logger(`Found model ${modelName} in database`)
          
          // Use dynamic import to break circular dependency
          const { Schema } = await import('@/schema/Schema')
          const schema = Schema.create(schemaName)
          const schemaSnapshot = schema.getService().getSnapshot()
          
          if (schemaSnapshot.value === 'idle') {
            const schemaContext = schemaSnapshot.context
            if (schemaContext.models && schemaContext.models[modelName]) {
              const modelData = schemaContext.models[modelName]
              sendBack({
                type: 'loadOrCreateModelSuccess',
                model: {
                  description: modelData.description,
                  properties: modelData.properties || {},
                  indexes: modelData.indexes,
                  _modelFileId: dbModel.schemaFileId || undefined,
                },
              })
              return
            }
          }
        }
      } catch (error) {
        logger(`Error loading model from database: ${error}`)
      }
    }

    // Create new empty model
    logger(`Creating new model ${modelName} in schema ${schemaName}`)
    sendBack({
      type: 'loadOrCreateModelSuccess',
      model: {
        description: undefined,
        properties: {},
        indexes: undefined,
        _modelFileId: undefined,
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

