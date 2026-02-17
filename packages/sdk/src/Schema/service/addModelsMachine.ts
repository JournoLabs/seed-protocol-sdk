import { assign, setup, fromCallback } from 'xstate'
import type { EventObject, DoneActorEvent } from 'xstate'
import { SchemaMachineContext } from './schemaMachine'
import { Model } from '@/Model/Model'
import type { Schema } from '../Schema'
import { BaseDb } from '@/db/Db/BaseDb'
import { generateId } from '@/helpers'
import { addModelsToDb } from '@/helpers/db'
import { createModelFromJson } from '@/imports/json'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { eq, desc } from 'drizzle-orm'

export type AddModelsMachineContext = {
  schemaContext: SchemaMachineContext
  models: { [modelName: string]: any }
  existingModels: { [modelName: string]: any }
  modelInstances?: Map<string, Model>
  modelFileIds?: Map<string, string>
  errors?: Array<{ modelName: string; error: Error }>
  addedModels?: { addedModels: any }
  progress?: {
    stage: 'preparing' | 'creatingInstances' | 'collectingIds' | 'persisting'
    currentModel?: string
    totalModels: number
    completedModels: number
  }
}

export const addModelsMachine = setup({
  types: {
    context: {} as AddModelsMachineContext,
    input: {} as {
      schemaContext: SchemaMachineContext
      models: { [modelName: string]: any }
      existingModels: { [modelName: string]: any }
    },
    events: {} as
      | { type: 'validateModels' }
      | { type: 'createModelInstances' }
      | { type: 'collectModelFileIds' }
      | { type: 'persistModelsToDb' }
      | { type: 'progress'; stage: 'preparing' | 'creatingInstances' | 'collectingIds' | 'persisting'; currentModel?: string }
      | { type: 'error'; error: Error; modelName?: string },
  },
  actors: {
    validateModels: fromCallback<
      EventObject,
      { newModels: { [modelName: string]: any }; existingModels: { [modelName: string]: any } }
    >(({ sendBack, input }) => {
      const _validate = async () => {
        // Check for duplicate model names
        const newModelNames = Object.keys(input.newModels)
        const existingModelNames = Object.keys(input.existingModels || {})
        
        for (const modelName of newModelNames) {
          if (existingModelNames.includes(modelName)) {
            throw new Error(`Model "${modelName}" already exists in schema`)
          }
        }
        
        // Check for duplicates within new models
        const seenNames = new Set<string>()
        for (const modelName of newModelNames) {
          if (seenNames.has(modelName)) {
            throw new Error(`Duplicate model name detected: "${modelName}". Each model must have a unique name.`)
          }
          seenNames.add(modelName)
        }
        
        // Basic validation - ensure models have required structure
        for (const [modelName, modelDef] of Object.entries(input.newModels)) {
          if (!modelDef || typeof modelDef !== 'object') {
            throw new Error(`Invalid model definition for "${modelName}": must be an object`)
          }
          if (!modelDef.properties || typeof modelDef.properties !== 'object') {
            throw new Error(`Model "${modelName}" must have a "properties" object`)
          }
        }
        
        sendBack({ type: 'done', output: { valid: true } })
      }
      
      _validate().catch((error) => {
        sendBack({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
      
      return () => {
        // Cleanup
      }
    }),
    createModelInstances: fromCallback<
      EventObject,
      { schemaContext: SchemaMachineContext; models: { [modelName: string]: any } }
    >(({ sendBack, input }) => {
      const _createInstances = async () => {
        const debug = (await import('debug')).default
        const logger = debug('seedSdk:schema:addModels:createInstances')
        const schemaMod = await import('../Schema')
        const { Schema: SchemaClass, schemaInstanceState } = schemaMod

        const schemaName = input.schemaContext.metadata?.name || input.schemaContext.schemaName
        const schemaInstance = SchemaClass.create(schemaName, {
          waitForReady: false,
        }) as Schema
        const modelInstances = new Map<string, Model>()

        // Get instance state to store model instances
        const instanceState = schemaInstanceState.get(schemaInstance)
        if (!instanceState) {
          throw new Error('Schema instance state not found')
        }
        
        for (const [modelName, modelData] of Object.entries(input.models)) {
          try {
            logger(`Creating model instance for "${modelName}"`)
            
            // Look up modelFileId from database BEFORE creating the Model instance
            let modelFileId: string | undefined = undefined
            try {
              const db = BaseDb.getAppDb()
              if (db) {
                const dbModels = await db
                  .select()
                  .from(modelsTable)
                  .where(eq(modelsTable.name, modelName))
                  .limit(1)
                
                if (dbModels.length > 0 && dbModels[0].schemaFileId) {
                  modelFileId = dbModels[0].schemaFileId
                  logger(`Found modelFileId "${modelFileId}" for model "${modelName}" from database`)
                }
              }
            } catch (error) {
              logger(`Error looking up modelFileId from database: ${error}`)
            }
            
            // If not found in database, generate a new modelFileId for new models
            if (!modelFileId) {
              modelFileId = generateId()
              logger(`Generated new modelFileId "${modelFileId}" for new model "${modelName}"`)
            }
            
            // Create new Model instance with modelFileId
            // Model.create() will set _modelFileId in the context automatically
            const modelInstance = Model.create(modelName, schemaName, {
              modelFileId,
              waitForReady: false,
            }) as Model
            const service = modelInstance.getService()
            
            logger(`Created Model instance for "${modelName}" with modelFileId "${modelFileId}"`)
            
            // Wait for the Model service to finish loading (loadOrCreateModel completes)
            await new Promise<void>((resolve) => {
              let resolved = false
              let subscription: any = null
              
              // Check if already idle
              const snapshot = service.getSnapshot()
              if (snapshot.value === 'idle') {
                const currentModelFileId = snapshot.context._modelFileId
                if (currentModelFileId === modelFileId) {
                  logger(`ModelFileId "${modelFileId}" correctly set for model "${modelName}"`)
                } else {
                  logger(`WARNING: ModelFileId not set for model "${modelName}" (expected: "${modelFileId}", got: "${currentModelFileId || 'undefined'}")`)
                  // Try to set it again
                  service.send({
                    type: 'updateContext',
                    _modelFileId: modelFileId,
                  })
                }
                resolved = true
                resolve()
                return
              }
              
              // Wait for service to become idle
              subscription = service.subscribe((snapshot) => {
                if (snapshot.value === 'idle') {
                  if (subscription) {
                    subscription.unsubscribe()
                    subscription = null
                  }
                  
                  const currentModelFileId = snapshot.context._modelFileId
                  if (currentModelFileId === modelFileId) {
                    logger(`ModelFileId "${modelFileId}" correctly set for model "${modelName}"`)
                  } else {
                    logger(`WARNING: ModelFileId not set for model "${modelName}" (expected: "${modelFileId}", got: "${currentModelFileId || 'undefined'}")`)
                    // Try to set it again - but only once to avoid infinite loop
                    if (!resolved) {
                      service.send({
                        type: 'updateContext',
                        _modelFileId: modelFileId,
                      })
                    }
                  }
                  
                  if (!resolved) {
                    resolved = true
                    resolve()
                  }
                } else if (snapshot.value === 'error') {
                  if (subscription) {
                    subscription.unsubscribe()
                    subscription = null
                  }
                  if (!resolved) {
                    resolved = true
                    resolve()
                  }
                }
              })
              
              // Timeout after 2 seconds
              setTimeout(() => {
                if (subscription) {
                  subscription.unsubscribe()
                  subscription = null
                }
                if (!resolved) {
                  resolved = true
                  resolve()
                }
              }, 2000)
            })
            
            // Update the model instance with current data
            modelInstance.getService().send({
              type: 'updateContext',
              properties: modelData.properties || {},
            })
            
            // Initialize original values
            modelInstance.getService().send({
              type: 'initializeOriginalValues',
              originalValues: {
                _originalValues: {
                  properties: modelData.properties ? JSON.parse(JSON.stringify(modelData.properties)) : {},
                },
              },
              isEdited: false,
            })
            
            // Store in instance state
            if (!instanceState.modelInstances) {
              instanceState.modelInstances = new Map<string, Model>()
            }
            instanceState.modelInstances.set(modelName, modelInstance)
            modelInstances.set(modelName, modelInstance)
            
            logger(`Successfully created model instance for "${modelName}"`)
          } catch (error) {
            logger(`Error creating model instance for "${modelName}": ${error}`)
            throw error
          }
        }
        
        sendBack({
          type: 'done',
          output: { modelInstances }
        })
      }
      
      _createInstances().catch((error) => {
        sendBack({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
      
      return () => {
        // Cleanup
      }
    }),
    collectModelFileIds: fromCallback<
      EventObject,
      { modelInstances: Map<string, Model> }
    >(({ sendBack, input }) => {
      const _collectIds = async () => {
        const debug = (await import('debug')).default
        const logger = debug('seedSdk:schema:addModels:collectIds')
        
        const modelFileIds = new Map<string, string>()
        
        for (const [modelName, modelInstance] of input.modelInstances.entries()) {
          try {
            const service = modelInstance.getService()
            let modelFileId: string | undefined = undefined
            
            // Check current snapshot first
            const snapshot = service.getSnapshot()
            if (snapshot.value === 'idle' && snapshot.context._modelFileId) {
              modelFileId = snapshot.context._modelFileId
            } else {
              // If not ready, wait for it to become idle
              await new Promise<void>((resolve) => {
                const subscription = service.subscribe((snapshot) => {
                  if (snapshot.value === 'idle') {
                    subscription.unsubscribe()
                    if (snapshot.context._modelFileId) {
                      modelFileId = snapshot.context._modelFileId
                    }
                    resolve()
                  } else if (snapshot.value === 'error') {
                    subscription.unsubscribe()
                    resolve()
                  }
                })
                
                // Timeout after 1 second
                setTimeout(() => {
                  subscription.unsubscribe()
                  resolve()
                }, 1000)
              })
            }
            
            if (modelFileId) {
              modelFileIds.set(modelName, modelFileId)
              logger(`Collected modelFileId "${modelFileId}" for model "${modelName}"`)
            } else {
              logger(`WARNING: modelFileId not found for model "${modelName}" after waiting`)
            }
          } catch (error) {
            logger(`Error collecting modelFileId for "${modelName}": ${error}`)
            // Continue with other models even if one fails
          }
        }
        
        sendBack({
          type: 'done',
          output: { modelFileIds }
        })
      }
      
      _collectIds().catch((error) => {
        sendBack({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
      
      return () => {
        // Cleanup
      }
    }),
    persistModelsToDb: fromCallback<
      EventObject,
      {
        schemaContext: SchemaMachineContext
        models: { [modelName: string]: any }
        modelFileIds: Map<string, string>
      }
    >(({ sendBack, input }) => {
      const _persist = async () => {
        const debug = (await import('debug')).default
        const logger = debug('seedSdk:schema:addModels:persist')

        // Only process in browser environment where store is available
        if (typeof window === 'undefined') {
          logger('Not in browser environment, skipping store update')
          sendBack({
            type: 'done',
            output: { addedModels: input.models }
          })
          return
        }
        
        const schemaName = input.schemaContext.metadata?.name || input.schemaContext.schemaName
        const schemaFileId = input.schemaContext.id // id is the schemaFileId (string) in SchemaMachineContext
        const db = BaseDb.getAppDb()
        if (!db) {
          logger('Database not found, skipping model store update')
          sendBack({
            type: 'done',
            output: { addedModels: input.models }
          })
          return
        }
        
        // Find schema record - prefer schemaFileId lookup (more reliable), then fall back to name
        // Retry up to 3 times with a short delay in case schema is still being saved
        let schemaRecord: typeof schemasTable.$inferSelect | undefined
        const maxRetries = 3
        const retryDelay = 100 // ms
        
        for (let attempt = 0; attempt < maxRetries && !schemaRecord; attempt++) {
          if (attempt > 0) {
            logger(`Retry ${attempt}/${maxRetries - 1} to find schema, waiting ${retryDelay}ms...`)
            await new Promise(resolve => setTimeout(resolve, retryDelay))
          }
          
          // PRIMARY: Look up by schemaFileId if available (most reliable, independent of name changes)
          if (schemaFileId) {
            logger(`Looking up schema by schemaFileId: ${schemaFileId} (attempt ${attempt + 1})`)
            const schemasById = await db
              .select()
              .from(schemasTable)
              .where(eq(schemasTable.schemaFileId, schemaFileId))
              .limit(1)
            
            if (schemasById.length > 0) {
              schemaRecord = schemasById[0]
              if (schemaRecord) {
                logger(`Found schema by schemaFileId: ${schemaFileId} (id: ${schemaRecord.id}, name: ${schemaRecord.name}, isDraft: ${schemaRecord.isDraft})`)
              }
              break
            } else {
              logger(`No schema found by schemaFileId: ${schemaFileId}, will try by name`)
            }
          }
          
          // FALLBACK: If not found by schemaFileId, try by name (prefer draft records)
          if (!schemaRecord) {
            logger(`Looking up schema by name: "${schemaName}" (attempt ${attempt + 1})`)
            const schemasByName = await db
              .select()
              .from(schemasTable)
              .where(eq(schemasTable.name, schemaName))
              .orderBy(desc(schemasTable.isDraft), desc(schemasTable.version))
              .limit(10) // Get multiple to find drafts
            
            if (schemasByName.length > 0) {
              // Prefer draft records
              const draftRecord = schemasByName.find((s: typeof schemasTable.$inferSelect) => s.isDraft === true)
              schemaRecord = draftRecord || schemasByName[0]
              if (schemaRecord) {
                logger(`Found schema by name "${schemaName}": selected ${draftRecord ? 'draft' : 'first'} record (id: ${schemaRecord.id}, isDraft: ${schemaRecord.isDraft})`)
              }
              break
            }
          }
        }
        
        if (!schemaRecord) {
          logger(`Schema "${schemaName}" (schemaFileId: ${schemaFileId || 'none'}) not found in database after ${maxRetries} attempts, skipping model store update`)
          sendBack({
            type: 'done',
            output: { addedModels: input.models }
          })
          return
        }
        
        // Convert schema model format to JSON import format for createModelFromJson
        const modelDefinitions: { [modelName: string]: any } = {}
        
        for (const [modelName, modelDef] of Object.entries(input.models)) {
          // Convert properties from schema format to JSON import format
          const convertedProperties: { [propName: string]: any } = {}
          if (modelDef.properties) {
            for (const [propName, propDef] of Object.entries(modelDef.properties)) {
              // Schema format: { dataType, ref, refValueType, storageType, localStorageDir, filenameSuffix }
              // JSON import format: { type, model, items, storage: { type, path, extension } }
              const schemaProp = propDef as any
              const jsonProp: any = {
                type: schemaProp.dataType || schemaProp.type,
              }
              
              // Handle Relation type
              if (schemaProp.ref || schemaProp.refModelName) {
                jsonProp.model = schemaProp.refModelName || schemaProp.ref
              }
              
              // Handle List type
              if (schemaProp.dataType === 'List' && schemaProp.refValueType) {
                jsonProp.items = { type: schemaProp.refValueType }
                if (schemaProp.ref || schemaProp.refModelName) {
                  jsonProp.items.model = schemaProp.refModelName || schemaProp.ref
                }
              }
              
              // Handle storage configuration
              if (schemaProp.storageType || schemaProp.localStorageDir || schemaProp.filenameSuffix) {
                jsonProp.storage = {
                  type: schemaProp.storageType === 'ItemStorage' ? 'ItemStorage' : 'PropertyStorage',
                  path: schemaProp.localStorageDir,
                  extension: schemaProp.filenameSuffix,
                }
              }
              
              convertedProperties[propName] = jsonProp
            }
          }
          
          // Create model definition in JSON import format
          // Note: description is not passed - JSON files can have it but we ignore it at runtime
          const jsonModelDef = {
            properties: convertedProperties,
          }
          
          // Create Model instance
          const ModelClass = await createModelFromJson(modelName, jsonModelDef, schemaName)
          modelDefinitions[modelName] = ModelClass
          
          // Model is now accessible via Model static methods, no registration needed
          logger(`Created model "${modelName}"`)
        }
        
        // Add models to database with modelFileIds
        if (Object.keys(modelDefinitions).length > 0) {
          await addModelsToDb(modelDefinitions, schemaRecord, undefined, {
            schemaFileId: input.schemaContext.id, // id is the schemaFileId (string) in SchemaMachineContext
            modelFileIds: input.modelFileIds.size > 0 ? input.modelFileIds : undefined,
          })
          logger(`Added ${Object.keys(modelDefinitions).length} new models to database`)
        }
        
        sendBack({
          type: 'done',
          output: { addedModels: input.models }
        })
      }
      
      _persist().catch((error) => {
        sendBack({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      })
      
      return () => {
        // Cleanup
      }
    }),
  },
}).createMachine({
  id: 'addModels',
  initial: 'preparing',
  context: ({ input }) => ({
    schemaContext: input.schemaContext,
    models: input.models,
    existingModels: input.existingModels,
    progress: {
      stage: 'preparing',
      totalModels: Object.keys(input.models).length,
      completedModels: 0,
    },
  }),
  states: {
    preparing: {
      invoke: {
        src: 'validateModels',
        input: ({ context }) => ({
          newModels: context.models,
          existingModels: context.existingModels,
        }),
        onDone: {
          target: 'creatingInstances',
          actions: assign({
            progress: ({ context }) => ({
              ...context.progress!,
              stage: 'creatingInstances',
            }),
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            errors: ({ context, event }) => [
              ...(context.errors || []),
              { 
                modelName: 'validation', 
                error: event.error instanceof Error ? event.error : new Error(String(event.error))
              },
            ],
          }),
        },
      },
    },
    creatingInstances: {
      invoke: {
        src: 'createModelInstances',
        input: ({ context }) => ({
          schemaContext: context.schemaContext,
          models: context.models,
        }),
        onDone: {
          target: 'collectingIds',
          actions: assign({
            modelInstances: ({ event }) => {
              // Type assertion needed due to XState v5 type inference limitation
              const doneEvent = event as unknown as { output: { modelInstances: Map<string, Model> } }
              return doneEvent.output?.modelInstances
            },
            progress: ({ context }) => ({
              ...context.progress!,
              stage: 'collectingIds',
            }),
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            errors: ({ context, event }) => [
              ...(context.errors || []),
              { 
                modelName: 'createInstances', 
                error: event.error instanceof Error ? event.error : new Error(String(event.error))
              },
            ],
          }),
        },
      },
    },
    collectingIds: {
      invoke: {
        src: 'collectModelFileIds',
        input: ({ context }) => ({
          modelInstances: context.modelInstances!,
        }),
        onDone: {
          target: 'persisting',
          actions: assign({
            modelFileIds: ({ event }) => {
              // Type assertion needed due to XState v5 type inference limitation
              const doneEvent = event as unknown as { output: { modelFileIds: Map<string, string> } }
              return doneEvent.output?.modelFileIds
            },
            progress: ({ context }) => ({
              ...context.progress!,
              stage: 'persisting',
            }),
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            errors: ({ context, event }) => [
              ...(context.errors || []),
              { 
                modelName: 'collectIds', 
                error: event.error instanceof Error ? event.error : new Error(String(event.error))
              },
            ],
          }),
        },
      },
    },
    persisting: {
      invoke: {
        src: 'persistModelsToDb',
        input: ({ context }) => ({
          schemaContext: context.schemaContext,
          models: context.models,
          modelFileIds: context.modelFileIds!,
        }),
        onDone: {
          target: '#addModels.success',
          actions: assign({
            addedModels: ({ event }) => {
              // Type assertion needed due to XState v5 type inference limitation
              // Convert through unknown first to avoid type overlap error
              const doneEvent = event as unknown as DoneActorEvent<{ addedModels: any }, string>
              return { addedModels: doneEvent.output?.addedModels }
            },
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            errors: ({ context, event }) => [
              ...(context.errors || []),
              { modelName: 'persist', error: event.error instanceof Error ? event.error : new Error(String(event.error)) },
            ],
          }),
        },
      },
    },
    success: {
      id: 'success',
      type: 'final',
      output: ({ context }) => ({ addedModels: context.addedModels?.addedModels || [] }),
    },
    error: {
      type: 'final',
      output: ({ context }) => ({
        errors: context.errors || [],
      }),
    },
  },
})

