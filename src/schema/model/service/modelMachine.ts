import { assign, setup } from 'xstate'
import { loadOrCreateModel } from './actors/loadOrCreateModel'
import { validateModel } from './actors/validateModel'
import { ValidationError } from '@/schema/validation'

export type ModelMachineContext = {
  modelName: string
  schemaName: string
  description?: string
  properties: {
    [propertyName: string]: any
  }
  indexes?: string[]
  _modelFileId?: string // ID from JSON file
  _isEdited?: boolean
  _editedProperties?: Set<string>
  _validationErrors?: ValidationError[]
  // Store original values from the JSON schema file
  _originalValues?: {
    description?: string
    properties?: { [propertyName: string]: any }
    indexes?: string[]
  }
}

export const modelMachine = setup({
  types: {
    context: {} as ModelMachineContext,
    input: {} as Pick<ModelMachineContext, 'modelName' | 'schemaName'>,
    events: {} as
      | { type: 'updateContext'; [key: string]: any }
      | { type: 'loadOrCreateModel' }
      | { type: 'loadOrCreateModelSuccess'; model: Omit<ModelMachineContext, 'modelName' | 'schemaName' | '_isEdited' | '_editedProperties' | '_validationErrors'> }
      | { type: 'loadOrCreateModelError'; error: Error }
      | { type: 'initializeOriginalValues'; originalValues: Partial<ModelMachineContext>; isEdited?: boolean }
      | { type: 'markAsDraft'; propertyKey: string }
      | { type: 'clearDraft' }
      | { type: 'validateModel' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] },
  },
  actors: {
    loadOrCreateModel,
    validateModel,
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
    properties: {},
    _isDraft: false,
    _editedProperties: new Set<string>(),
    _validationErrors: undefined,
  }),
  on: {
    updateContext: {
      actions: assign(({ context, event }) => {
        const newContext = Object.assign({}, context) as any

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
          newContext[key] = (event as any)[key]
        }

        // Compare with original values and set _isEdited flag (only for non-internal updates)
        if (!onlyInternalFields && context._originalValues) {
          const hasChanges = Object.keys(event).some((key: string) => {
            if (key === 'type' || key.startsWith('_')) return false
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
      // Only trigger validation if we're updating non-internal fields
      guard: ({ event }: { event: any }) => {
        return !Object.keys(event).every((key: string) => {
          return key === 'type' || key.startsWith('_')
        })
      },
      target: '.validating',
    },
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
        _originalValues: event.originalValues,
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
          description: context.description,
          properties: context.properties ? JSON.parse(JSON.stringify(context.properties)) : {},
          indexes: context.indexes ? [...context.indexes] : undefined,
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
            return {
              ...context,
              description: event.model.description,
              properties: event.model.properties || {},
              indexes: event.model.indexes,
              _modelFileId: event.model._modelFileId,
              _isEdited: false,
              _editedProperties: new Set<string>(),
              _validationErrors: undefined,
              _originalValues: {
                description: event.model.description,
                properties: event.model.properties ? JSON.parse(JSON.stringify(event.model.properties)) : {},
                indexes: event.model.indexes ? [...(event.model.indexes || [])] : undefined,
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
    error: {},
  },
})

