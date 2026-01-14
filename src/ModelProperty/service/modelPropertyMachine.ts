import { assign, setup, spawn, ActorRefFrom } from 'xstate'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/Schema'
import { saveToSchema } from './actors/saveToSchema'
import { compareAndMarkDraft } from './actors/compareAndMarkDraft'
import { validateProperty } from './actors/validateProperty'
import { ValidationError } from '@/Schema/validation'
import { writeProcessMachine } from '@/services/write/writeProcessMachine'

export type ModelPropertyMachineContext = Static<typeof TProperty> & {
  // Store original values from the JSON schema file
  _originalValues?: Partial<Static<typeof TProperty>>
  // Track if this property has been edited
  _isEdited?: boolean
  // Reference to the Schema instance this property belongs to
  _schemaName?: string
  // Validation errors
  _validationErrors?: ValidationError[]
  writeProcess?: ActorRefFrom<typeof writeProcessMachine> | null
  // Property file ID (schemaFileId from JSON schema file) - used for lookups
  _propertyFileId?: string
  // Note: id field (from TProperty) is now the schemaFileId (string)
  // _dbId (from TProperty) stores the database integer ID
}

export const modelPropertyMachine = setup({
  types: {
    context: {} as ModelPropertyMachineContext,
    input: {} as ModelPropertyMachineContext,
    events: {} as
      | { type: 'updateContext'; [key: string]: any }
      | { type: 'initializeOriginalValues'; originalValues: Partial<Static<typeof TProperty>>; schemaName?: string; isEdited?: boolean }
      | { type: 'clearEdited' }
      | { type: 'setSchemaName'; schemaName: string }
      | { type: 'saveToSchema' }
      | { type: 'saveToSchemaSuccess' }
      | { type: 'saveToSchemaError'; error: Error }
      | { type: 'compareAndMarkDraftSuccess' }
      | { type: 'compareAndMarkDraftError' }
      | { type: 'validateProperty' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] }
      | { type: 'requestWrite'; data: any },
  },
  actors: {
    saveToSchema,
    compareAndMarkDraft,
    validateProperty,
    writeProcessMachine,
  },
  guards: {
    isPropertyValid: ({ context }) => {
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
  id: 'modelProperty',
  initial: 'idle',
  context: ({ input }) => {
    const context = input as ModelPropertyMachineContext
    console.log('[modelPropertyMachine] Initializing context with input:', JSON.stringify({
      name: context.name,
      modelName: context.modelName,
      ref: context.ref,
      refModelName: context.refModelName,
      refModelId: context.refModelId,
      dataType: context.dataType,
    }, null, 2))
    return context
  },
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
          let value = (event as any)[key]
          // Convert null to undefined for optional fields (TypeBox validation expects undefined, not null)
          // This is especially important for refValueType, refModelId, etc.
          if (value === null && (key === 'refValueType' || key === 'refModelId' || key === 'ref' || key === 'refModelName')) {
            value = undefined
          }
          newContext[key] = value
        }

        // Compare with original values and set _isEdited flag (only for non-internal updates)
        if (!onlyInternalFields && context._originalValues) {
          const hasChanges = Object.keys(event).some((key: string) => {
            if (key === 'type' || key.startsWith('_')) return false
            return newContext[key] !== (context._originalValues as any)?.[key]
          })
          newContext._isEdited = hasChanges
        }

        // Clear validation errors on context update (will be re-validated if needed)
        newContext._validationErrors = undefined

        // Convert null to undefined for optional fields (TypeBox validation expects undefined, not null)
        // This is especially important for refValueType, refModelId, etc.
        const optionalFields = ['refValueType', 'refModelId', 'ref', 'refModelName']
        for (const field of optionalFields) {
          if (newContext[field] === null) {
            newContext[field] = undefined
          }
        }

        return newContext
      }),
      // Only trigger validation and compareAndMarkDraft if we're updating non-internal fields
      guard: ({ event }: { event: any }) => {
        return !Object.keys(event).every((key: string) => {
          return key === 'type' || key.startsWith('_')
        })
      },
      target: '.validating',
    },
    validateProperty: {
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
      // Note: State-specific transitions are handled in child states
      // This root handler ensures errors are always assigned to context
    },
    initializeOriginalValues: {
      actions: assign(({ context, event }) => ({
        ...context,
        _originalValues: event.originalValues,
        _schemaName: event.schemaName,
        _isEdited: event.isEdited ?? false,
        _validationErrors: undefined,
      })),
    },
    clearEdited: {
      actions: assign(({ context }) => ({
        ...context,
        _isEdited: false,
        _originalValues: { ...context } as Partial<Static<typeof TProperty>>,
      })),
    },
    setSchemaName: {
      actions: assign(({ context, event }) => ({
        ...context,
        _schemaName: event.schemaName,
      })),
    },
  },
  states: {
    idle: {
      entry: assign({
        writeProcess: ({ spawn, context }) => {
          // Spawn writeProcess if we have id (schemaFileId)
          // New properties will have id generated
          const entityId = context.id
          if (!context.writeProcess && entityId) {
            return spawn(writeProcessMachine, {
              input: {
                entityType: 'modelProperty',
                entityId: String(entityId),
                entityData: context,
              },
            })
          }
          return context.writeProcess
        },
      }),
      on: {
        validateProperty: {
          target: 'validating',
        },
        requestWrite: {
          actions: ({ context, event }) => {
            if (context.writeProcess) {
              context.writeProcess.send({
                type: 'startWrite',
                data: event.data,
              })
            }
          },
        },
      },
    },
    validating: {
      on: {
        validationSuccess: {
          target: 'compareAndMarkDraft',
          actions: assign(({ context, event }) => ({
            ...context,
            _validationErrors: [],
          })),
        },
        // validationError: Uses root handler for assignment, but needs state-specific transition
        validationError: {
          target: 'idle',
          actions: 'assignValidationErrors',
        },
      },
      invoke: {
        src: 'validateProperty',
        input: ({ context }) => ({ context }),
      },
    },
    compareAndMarkDraft: {
      on: {
        compareAndMarkDraftSuccess: {
          target: 'idle',
        },
        compareAndMarkDraftError: {
          target: 'idle',
        },
      },
      invoke: {
        src: 'compareAndMarkDraft',
        input: ({ context }: { context: ModelPropertyMachineContext }) => ({ context }),
      },
    },
    saveToSchema: {
      always: {
        guard: 'isPropertyValid',
        target: '.saving',
      },
      initial: 'saving',
      on: {
        // validationError: Uses root handler for assignment, but needs state-specific transition
        validationError: {
          target: 'idle',
          actions: 'assignValidationErrors',
        },
      },
      invoke: {
        src: 'validateProperty',
        input: ({ context }) => ({ context }),
      },
      states: {
        saving: {
          on: {
            saveToSchemaSuccess: {
              target: '#modelProperty.idle',
            },
            saveToSchemaError: {
              target: '#modelProperty.idle',
            },
          },
          invoke: {
            src: 'saveToSchema',
            input: ({ context }) => ({ context }),
          },
        },
      },
    },
  },
})
