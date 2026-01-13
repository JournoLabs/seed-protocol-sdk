import { assign, setup, ActorRefFrom } from 'xstate'
import { loadOrCreateModel } from './actors/loadOrCreateModel'
import { validateModel } from './actors/validateModel'
import { createModelProperties } from './actors/createModelProperties'
import { ValidationError } from '@/Schema/validation'
import { writeProcessMachine } from '@/services/write/writeProcessMachine'
import debug from 'debug'

const logger = debug('seedSdk:model:modelMachine')

export type ModelMachineContext = {
  modelName: string
  schemaName: string
  _modelFileId?: string // ID from JSON file
  _isEdited?: boolean
  _editedProperties?: Set<string>
  _validationErrors?: ValidationError[]
  // Store original values from the JSON schema file
  _originalValues?: {
    properties?: { [propertyName: string]: any } // Serialized snapshot for comparison only
  }
  writeProcess?: ActorRefFrom<typeof writeProcessMachine> | null
  modelId?: number // Store modelId for pending writes lookup
  _liveQueryPropertyIds?: string[] // Property file IDs from liveQuery (like Schema._liveQueryModelIds)
  _pendingPropertyDefinitions?: { [propertyName: string]: any } // Temporary storage for properties to create
  // Conflict detection metadata - track when data was loaded from DB
  _loadedAt?: number // Timestamp when data was loaded from DB
  _dbVersion?: number // DB version at load time
  _dbUpdatedAt?: number // DB updatedAt timestamp at load time (milliseconds)
}

export const modelMachine = setup({
  types: {
    context: {} as ModelMachineContext,
    input: {} as Pick<ModelMachineContext, 'modelName' | 'schemaName' | '_modelFileId' | '_pendingPropertyDefinitions'>,
    events: {} as
      | { type: 'updateContext'; [key: string]: any }
      | { type: 'loadOrCreateModel' }
      | { type: 'loadOrCreateModelSuccess'; model: Omit<ModelMachineContext, 'modelName' | 'schemaName' | '_isEdited' | '_editedProperties' | '_validationErrors' | '_loadedAt' | '_dbVersion' | '_dbUpdatedAt'> & Partial<Pick<ModelMachineContext, '_loadedAt' | '_dbVersion' | '_dbUpdatedAt'>> }
      | { type: 'loadOrCreateModelError'; error: Error }
      | { type: 'initializeOriginalValues'; originalValues: Partial<ModelMachineContext>; isEdited?: boolean }
      | { type: 'markAsDraft'; propertyKey: string }
      | { type: 'clearDraft' }
      | { type: 'validateModel' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] }
      | { type: 'reloadFromDb' }
      | { type: 'requestWrite'; data: any }
      | { type: 'writeSuccess'; output: any }
      | { type: 'createModelPropertiesSuccess' }
      | { type: 'createModelPropertiesError'; error: Error }
      | { type: 'refreshProperties' },
  },
  actors: {
    loadOrCreateModel,
    validateModel,
    createModelProperties,
    writeProcessMachine,
  },
  guards: {
    isModelValid: ({ context }) => {
      return !context._validationErrors || context._validationErrors.length === 0
    },
    hasValidationErrors: ({ context }) => {
      return !!context._validationErrors && context._validationErrors.length > 0
    },
  },
  actions: {
    assignValidationErrors: assign(({ context, event }) => {
      if (event.type === 'validationError') {
        return {
          ...context,
          _validationErrors: event.errors,
        }
      }
      return context
    }),
  },
}).createMachine({
  id: 'model',
  initial: 'loading',
  context: ({ input }) => ({
    modelName: input.modelName,
    schemaName: input.schemaName,
    _modelFileId: input._modelFileId,
    _pendingPropertyDefinitions: input._pendingPropertyDefinitions,
    _isDraft: false,
    _editedProperties: new Set<string>(),
    _validationErrors: undefined,
    writeProcess: undefined,
    modelId: undefined,
    _liveQueryPropertyIds: [], // Initialize empty array
  }),
  on: {
    updateContext: [
      {
        // Always update context first (no guard, always runs)
        actions: [
          assign(({ context, event }) => {
          const newContext = { ...context } as any

          // Check if this is only updating internal fields
          const onlyInternalFields = Object.keys(event).every((key: string) => {
            return key === 'type' || key.startsWith('_')
          })

          // Update the context with new values
          for (let i = 0; i < Object.keys(event).length; i++) {
            const key = Object.keys(event)[i] as string
            if (key === 'type') {
              continue
            }
            const eventValue = (event as any)[key]
            // Ensure arrays are properly copied (create new reference)
            newContext[key] = Array.isArray(eventValue) ? [...eventValue] : eventValue
          }
          
          // Log _liveQueryPropertyIds updates for debugging
          if ((event as any)._liveQueryPropertyIds !== undefined) {
            const ids = newContext._liveQueryPropertyIds
            console.log(`[modelMachine] updateContext: Set _liveQueryPropertyIds for "${context.modelName}" to:`, Array.isArray(ids) ? `[${ids.length} items: ${ids.join(', ')}]` : ids)
            console.log(`[modelMachine] updateContext: Returning newContext with _liveQueryPropertyIds:`, Array.isArray(newContext._liveQueryPropertyIds) ? `[${newContext._liveQueryPropertyIds.length} items: ${newContext._liveQueryPropertyIds.join(', ')}]` : newContext._liveQueryPropertyIds)
          }

          // Compare with original values and set _isEdited flag (only for non-internal updates)
          // Note: properties are not in context - they're computed from ModelProperty instances
          // Property changes are tracked via ModelProperty._isEdited flags
          if (!onlyInternalFields && context._originalValues) {
            const hasChanges = Object.keys(event).some((key: string) => {
              if (key === 'type' || key.startsWith('_') || key === 'properties') return false
              const newValue = newContext[key]
              const oldValue = (context._originalValues as any)?.[key]
              
              // Deep comparison for objects/arrays
              if (typeof newValue === 'object' && typeof oldValue === 'object') {
                return JSON.stringify(newValue) !== JSON.stringify(oldValue)
              }
              return newValue !== oldValue
            })
            newContext._isEdited = hasChanges
          }

          // Clear validation errors on context update (will be re-validated if needed)
          newContext._validationErrors = undefined

          return newContext
        }),
        // Verify the context was updated and create property instances if needed
        ({ context, event, self }) => {
          if ((event as any)._liveQueryPropertyIds !== undefined) {
            const newPropertyIds = (event as any)._liveQueryPropertyIds as string[]
            // Use setTimeout to check after assign has been applied
            setTimeout(() => {
              const snapshot = self.getSnapshot()
              console.log(`[modelMachine] updateContext: After assign, snapshot.context._liveQueryPropertyIds for "${context.modelName}":`, Array.isArray(snapshot.context._liveQueryPropertyIds) ? `[${snapshot.context._liveQueryPropertyIds.length} items: ${snapshot.context._liveQueryPropertyIds.join(', ')}]` : snapshot.context._liveQueryPropertyIds)
              
              // Create ModelProperty instances for any new property IDs
              if (Array.isArray(newPropertyIds) && newPropertyIds.length > 0) {
                // Import and create instances asynchronously (fire-and-forget)
                import('@/ModelProperty/ModelProperty').then(({ ModelProperty }) => {
                  const createPromises = newPropertyIds.map(async (propertyFileId) => {
                    try {
                      const property = await ModelProperty.createById(propertyFileId)
                      if (property) {
                        logger(`[modelMachine] Created/cached ModelProperty instance for propertyFileId "${propertyFileId}" after _liveQueryPropertyIds update`)
                      }
                    } catch (error) {
                      logger(`[modelMachine] Error creating ModelProperty instance for propertyFileId "${propertyFileId}": ${error}`)
                    }
                  })
                  Promise.all(createPromises).catch((error) => {
                    logger(`[modelMachine] Error creating property instances: ${error}`)
                  })
                }).catch((error) => {
                  logger(`[modelMachine] Error importing ModelProperty: ${error}`)
                })
              }
            }, 0)
          }
        },
        ],
        // Don't transition - stay in current state, context will be updated
      },
      {
        // Conditionally trigger validation for non-internal updates
        guard: ({ event }: { event: any }) => {
          return !Object.keys(event).every((key: string) => {
            return key === 'type' || key.startsWith('_')
          })
        },
        target: '.validating',
      },
    ],
    validateModel: {
      target: '.validating',
    },
    validationSuccess: {
      actions: assign(({ context, event }) => ({
        ...context,
        _validationErrors: [],
      })),
    },
    validationError: {
      actions: 'assignValidationErrors',
    },
    initializeOriginalValues: {
      actions: assign(({ context, event }) => ({
        ...context,
        _originalValues: event.originalValues as { properties?: { [propertyName: string]: any } },
        _isEdited: event.isEdited ?? false,
        _validationErrors: undefined,
      })),
    },
    markAsDraft: {
      actions: assign(({ context, event }) => ({
        ...context,
        _isEdited: true,
        _editedProperties: new Set([
          ...(context._editedProperties || []),
          event.propertyKey,
        ]),
      })),
    },
    clearDraft: {
      actions: assign(({ context }) => ({
        ...context,
        _isEdited: false,
        _editedProperties: new Set<string>(),
        _originalValues: {
          // Properties are not stored in context - they're computed from ModelProperty instances
          // Properties serialization happens separately when initializing original values
        },
      })),
    },
  },
  states: {
    loading: {
      on: {
        loadOrCreateModelSuccess: {
          target: 'idle',
          actions: assign(({ context, event }) => {
            const hasPendingProps = !!(context._pendingPropertyDefinitions && Object.keys(context._pendingPropertyDefinitions).length > 0)
            logger(`[loadOrCreateModelSuccess] Preserving _pendingPropertyDefinitions: ${hasPendingProps} (${Object.keys(context._pendingPropertyDefinitions || {}).length} properties)`)
            return {
              ...context,
              _modelFileId: event.model._modelFileId,
              modelId: event.model.modelId, // Set modelId if provided (from database lookup)
              _isEdited: false,
              _editedProperties: new Set<string>(),
              _validationErrors: undefined,
              // Preserve _pendingPropertyDefinitions if it exists
              _pendingPropertyDefinitions: context._pendingPropertyDefinitions,
              // Preserve conflict detection metadata if provided
              _loadedAt: event.model._loadedAt,
              _dbVersion: event.model._dbVersion,
              _dbUpdatedAt: event.model._dbUpdatedAt,
              _originalValues: {
                // Properties are not stored in context - they're computed from ModelProperty instances
                // Properties will be loaded via liveQuery after model creation
              },
            }
          }),
        },
        loadOrCreateModelError: {
          target: 'error',
        },
      },
      invoke: {
        src: 'loadOrCreateModel',
        input: ({ context }) => ({ context }),
      },
    },
    idle: {
      entry: assign({
        writeProcess: ({ context, spawn }) => {
          if (!context.writeProcess && context._modelFileId) {
            logger(`[idle entry] Spawning writeProcess for model "${context.modelName}" (${context._modelFileId})`)
            return spawn(writeProcessMachine, {
              input: {
                entityType: 'model',
                entityId: context._modelFileId,
                entityData: {
                  modelName: context.modelName,
                  schemaName: context.schemaName,
                  // Properties are not stored in context - they'll be provided via requestWrite event
                },
              },
            })
          }
          return context.writeProcess
        },
      }),
      on: {
        refreshProperties: {
          actions: ({ self }) => {
            // This event will be handled by the Model instance's subscription
            // The Model will call _refreshPropertiesFromDb when it receives this event
            logger(`[idle] refreshProperties event received, will be handled by Model instance`)
          },
        },
        validateModel: {
          target: 'validating',
        },
        reloadFromDb: {
          target: 'loading',
        },
        requestWrite: {
          actions: ({ context, event }) => {
            if (context.writeProcess) {
              logger(`[requestWrite] Sending startWrite to writeProcess with data:`, event.data)
              context.writeProcess.send({
                type: 'startWrite',
                data: event.data,
              })
            } else {
              logger(`[requestWrite] ERROR: writeProcess not available for model "${context.modelName}" (${context._modelFileId})`)
            }
          },
        },
        writeSuccess: [
          {
            guard: ({ context }) => {
              // If we have pending property definitions, transition to creatingProperties
              const hasPending = !!(context._pendingPropertyDefinitions && Object.keys(context._pendingPropertyDefinitions).length > 0)
              logger(`[writeSuccess guard] hasPending: ${hasPending}, _pendingPropertyDefinitions keys: ${context._pendingPropertyDefinitions ? Object.keys(context._pendingPropertyDefinitions).length : 0}`)
              return hasPending
            },
            target: 'creatingProperties',
            actions: assign(({ context, event }) => {
              logger(`[writeSuccess] Transitioning to creatingProperties for model "${context.modelName}"`)
              // Update modelId from write output if available
              const newContext = { ...context }
              if (event.output?.id) {
                newContext.modelId = event.output.id
                logger(`[writeSuccess] Updated modelId to ${event.output.id}`)
              }
              return newContext
            }),
          },
          {
            target: 'idle',
            actions: assign(({ context, event }) => {
              // Update modelId from write output if available
              const newContext = { ...context }
              if (event.output?.id) {
                newContext.modelId = event.output.id
              }
              return newContext
            }),
          },
        ],
      },
      always: {
        guard: 'hasValidationErrors',
        target: 'validating',
      },
    },
    validating: {
      on: {
        validationSuccess: {
          target: 'idle',
          actions: assign(({ context, event }) => ({
            ...context,
            _validationErrors: [],
          })),
        },
        validationError: {
          target: 'idle',
          actions: 'assignValidationErrors',
        },
      },
      invoke: {
        src: 'validateModel',
        input: ({ context }) => ({ context }),
      },
    },
    creatingProperties: {
      entry: ({ context }) => {
        logger(`[creatingProperties entry] Starting property creation for model "${context.modelName}" with ${Object.keys(context._pendingPropertyDefinitions || {}).length} properties`)
      },
      invoke: {
        src: 'createModelProperties',
        input: ({ context }) => {
          logger(`[creatingProperties invoke] Invoking createModelProperties with ${Object.keys(context._pendingPropertyDefinitions || {}).length} property definitions`)
          return {
            context,
            propertyDefinitions: context._pendingPropertyDefinitions || {},
          }
        },
      },
      on: {
        createModelPropertiesSuccess: {
          target: 'idle',
          actions: [
            assign(({ context }) => {
              // Only clear _pendingPropertyDefinitions, preserve everything else including _liveQueryPropertyIds
              console.log(`[modelMachine] creatingProperties createModelPropertiesSuccess: Context before assign - _liveQueryPropertyIds:`, context._liveQueryPropertyIds)
              const newContext = {
                ...context,
                _pendingPropertyDefinitions: undefined,
              }
              console.log(`[modelMachine] creatingProperties createModelPropertiesSuccess: Preserving _liveQueryPropertyIds:`, newContext._liveQueryPropertyIds)
              return newContext
            }),
            ({ context, self }) => {
              // Trigger property refresh after properties are created
              // This ensures _liveQueryPropertyIds is updated in Node.js where liveQuery isn't available
              setTimeout(() => {
                self.send({ type: 'refreshProperties' })
              }, 100) // Small delay to ensure properties are written to DB
            },
          ],
        },
        createModelPropertiesError: {
          target: 'error',
          actions: ({ event }) => {
            logger('Error creating model properties:', event.error)
          },
        },
      },
    },
    error: {},
  },
})

