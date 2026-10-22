import { assign, setup } from 'xstate'
import { loadOrCreateModel } from './actors/loadOrCreateModel'
import { validateModel } from './actors/validateModel'
import { ValidationError } from '@/Schema/validation'
import debug from 'debug'
import { applyContextUpdate, differsFromOriginals, isInternalUpdate } from '@/helpers/entity/contextUpdate'
import { currentEvictionEpoch } from '@/helpers/entity/evictionEpoch'

const logger = debug('seedSdk:model:modelMachine')

export type ModelMachineContext = {
  id?: string // schemaFileId (string) - public ID
  _dbId?: number // Database integer ID - internal only
  modelName: string
  schemaName: string
  _isEdited?: boolean
  _editedProperties?: Set<string>
  _validationErrors?: ValidationError[]
  // Store original values from the JSON schema file
  _originalValues?: {
    properties?: { [propertyName: string]: any } // Serialized snapshot for comparison only
  }
  _liveQueryPropertyIds?: string[] // Property file IDs from liveQuery (like Schema._liveQueryModelIds)
  _pendingPropertyDefinitions?: { [propertyName: string]: any } // Properties passed to Model.create, until created
  _modelFileId?: string // Model file ID (string) - used for tracking model instances
  // Conflict detection metadata - track when data was loaded from DB
  _loadedAt?: number // Timestamp when data was loaded from DB
  _dbVersion?: number // DB version at load time
  _dbUpdatedAt?: number // DB updatedAt timestamp at load time (milliseconds)
  _idFromSchema?: boolean // True when Model.create was called with modelFileId (schema model); skip duplicate-name rename
  // Destroy failure from the last destroy() (read by destroy hooks)
  _destroyError?: { message: string; name?: string } | null
}

export const modelMachine = setup({
  types: {
    context: {} as ModelMachineContext,
    input: {} as Pick<ModelMachineContext, 'modelName' | 'schemaName' | 'id' | '_pendingPropertyDefinitions' | '_idFromSchema'>,
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
      | { type: 'destroyStarted' }
      | { type: 'destroyError'; error: unknown },
  },
  actors: {
    loadOrCreateModel,
    validateModel,
  },
  guards: {
    isModelValid: ({ context }) => {
      return !context._validationErrors || context._validationErrors.length === 0
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
    id: input.id,
    _dbId: undefined,
    modelName: input.modelName,
    schemaName: input.schemaName,
    _pendingPropertyDefinitions: input._pendingPropertyDefinitions,
    _idFromSchema: input._idFromSchema,
    _isDraft: false,
    _editedProperties: new Set<string>(),
    _validationErrors: undefined,
    _liveQueryPropertyIds: [], // Initialize empty array
  }),
  on: {
    updateContext: [
      {
        // Always update context first (no guard, always runs)
        actions: [
          assign(({ context, event }) => {
            const next = applyContextUpdate(context, event)
            if (isInternalUpdate(event)) return next
            // Properties are computed from ModelProperty instances, which track their own edits
            const edited = differsFromOriginals(context._originalValues as Record<string, unknown>, next, event, ['properties'])
            return {
              ...next,
              ...(edited !== undefined && { _isEdited: edited }),
              // The validating state this update enters sets them again
              _validationErrors: undefined,
            }
          }),
        // Verify the context was updated and create property instances if needed
        ({ event, self }) => {
          if ((event as any)._liveQueryPropertyIds !== undefined) {
            const newPropertyIds = (event as any)._liveQueryPropertyIds as string[]
            // The model can be evicted with its schema (Schema.destroy, test cleanup) before the
            // timer and import below run: then create nothing, and drop lookups an eviction overtakes.
            const evictionEpoch = currentEvictionEpoch()
            // Use setTimeout to check after assign has been applied
            setTimeout(() => {
              const snapshot = self.getSnapshot()
              if (snapshot.status === 'stopped') return
              
              // Create ModelProperty instances for any new property IDs
              if (Array.isArray(newPropertyIds) && newPropertyIds.length > 0) {
                // Import and create instances asynchronously (fire-and-forget)
                import('@/ModelProperty/ModelProperty').then(({ ModelProperty }) => {
                  if (self.getSnapshot().status === 'stopped') return
                  const createPromises = newPropertyIds.map(async (propertyFileId) => {
                    try {
                      const property = await ModelProperty.createById(propertyFileId, { evictionEpoch })
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
        guard: ({ event }) => !isInternalUpdate(event),
        target: '.validating',
      },
    ],
    validateModel: {
      target: '.validating',
    },
    validationSuccess: {
      actions: assign(({ context }) => ({
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
    destroyStarted: {
      actions: assign({ _destroyError: null }),
    },
    destroyError: {
      actions: assign(({ event }) => ({
        _destroyError:
          event.error instanceof Error
            ? { message: event.error.message, name: event.error.name }
            : { message: String(event.error) },
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
            
            // Check if there's a pending model name update (set before this event to avoid validation trigger)
            const finalModelName = (context as any)._pendingModelName || context.modelName
            if ((context as any)._pendingModelName) {
              logger(`[loadOrCreateModelSuccess] Applying pending model name: "${context.modelName}" -> "${finalModelName}"`)
            }
            
            return {
              ...context,
              id: event.model.id, // schemaFileId (string)
              _dbId: event.model._dbId, // Database integer ID
              _isEdited: (event.model as any)._isEdited ?? false, // Load isEdited from database
              _editedProperties: new Set<string>(),
              _validationErrors: undefined,
              // Use final model name (may have been set via _pendingModelName to avoid validation trigger)
              modelName: finalModelName,
              // Clear the temporary field
              _pendingModelName: undefined,
              // Preserve _pendingPropertyDefinitions if it exists
              _pendingPropertyDefinitions: context._pendingPropertyDefinitions,
              // Preserve _liveQueryPropertyIds if provided (set by loadOrCreateModel when loading from DB)
              _liveQueryPropertyIds: (event.model as any)._liveQueryPropertyIds ?? context._liveQueryPropertyIds ?? [],
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
      on: {
        validateModel: {
          target: 'validating',
        },
        reloadFromDb: {
          target: 'loading',
        },
      },
      // No `always: hasValidationErrors -> validating` here: validation is re-run when the context changes
      // (updateContext) or on request (validateModel). Re-entering while errors exist would loop forever on a
      // model that is still invalid.
    },
    validating: {
      on: {
        validationSuccess: {
          target: 'idle',
          actions: assign(({ context }) => ({
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
    error: {},
  },
})

