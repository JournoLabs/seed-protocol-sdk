import { assign, setup } from 'xstate'
import { validateModel } from './actors/validateModel'
import { ValidationError } from '@/Schema/validation'
import type { LoadedModel } from '../loadModel'
import { applyContextUpdate, differsFromOriginals, isInternalUpdate } from '@/helpers/entity/contextUpdate'

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
      | { type: 'loaded'; model: LoadedModel }
      | { type: 'initializeOriginalValues'; originalValues: Partial<ModelMachineContext>; isEdited?: boolean }
      | { type: 'markAsDraft'; propertyKey: string }
      | { type: 'clearDraft' }
      | { type: 'validateModel' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] }
      | { type: 'destroyStarted' }
      | { type: 'destroyError'; error: unknown },
  },
  actors: {
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
  // Loading runs outside the machine (Model.load); its result arrives as `loaded`
  initial: 'idle',
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
        ],
        // Don't transition - stay in current state, context will be updated
      },
      {
        // Conditionally trigger validation for non-internal updates
        guard: ({ event }) => !isInternalUpdate(event),
        target: '.validating',
      },
    ],
    loaded: {
      actions: assign(({ context, event }) => ({
        ...context,
        ...event.model,
        modelName: event.model.modelName ?? context.modelName,
        _liveQueryPropertyIds: event.model._liveQueryPropertyIds ?? context._liveQueryPropertyIds ?? [],
        _isEdited: event.model._isEdited ?? false,
        _editedProperties: new Set<string>(),
        _validationErrors: undefined,
        // Properties are computed from ModelProperty instances, not compared here
        _originalValues: {},
      })),
    },
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
    idle: {
      on: {
        validateModel: {
          target: 'validating',
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
  },
})

