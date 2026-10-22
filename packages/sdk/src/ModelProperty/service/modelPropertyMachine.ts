import { applyContextUpdate, differsFromOriginals, isInternalUpdate } from '@/helpers/entity/contextUpdate'
import { assign, setup } from 'xstate'
import { Static } from '@sinclair/typebox'
import { TProperty } from '@/Schema'
import { saveToSchema } from './actors/saveToSchema'
import { compareAndMarkDraft } from './actors/compareAndMarkDraft'
import { validateProperty } from './actors/validateProperty'
import { ValidationError } from '@/Schema/validation'

export type ModelPropertyMachineContext = Static<typeof TProperty> & {
  // Store original values from the JSON schema file
  _originalValues?: Partial<Static<typeof TProperty>>
  // Track if this property has been edited
  _isEdited?: boolean
  // Reference to the Schema instance this property belongs to
  _schemaName?: string
  // Validation errors
  _validationErrors?: ValidationError[]
  // Property file ID (schemaFileId from JSON schema file) - used for lookups
  _propertyFileId?: string
  // Note: id field (from TProperty) is now the schemaFileId (string)
  // _dbId (from TProperty) stores the database integer ID
  // Destroy failure from the last destroy() (read by destroy hooks)
  _destroyError?: { message: string; name?: string } | null
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
      | { type: 'syncedFromStorage'; values: Partial<Static<typeof TProperty>> }
      | { type: 'saveToSchema' }
      | { type: 'saveToSchemaSuccess' }
      | { type: 'saveToSchemaError'; error: Error }
      | { type: 'compareAndMarkDraftSuccess' }
      | { type: 'compareAndMarkDraftError' }
      | { type: 'validateProperty' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] }
      | { type: 'destroyStarted' }
      | { type: 'destroyError'; error: unknown },
  },
  actors: {
    saveToSchema,
    compareAndMarkDraft,
    validateProperty,
  },
  guards: {
    isPropertyValid: ({ context }) => {
      const valid = !context._validationErrors || context._validationErrors.length === 0
      return valid
    },
  },
  actions: {
    applyUpdate: assign(({ context, event }) => {
      const next = applyContextUpdate(context, event) as Record<string, unknown>
      // TypeBox validation expects undefined, not null, for the optional ref fields
      for (const field of ['refValueType', 'refModelId', 'ref', 'refModelName']) {
        if (next[field] === null) next[field] = undefined
      }
      if (isInternalUpdate(event)) return next as ModelPropertyMachineContext
      // Validation and the row write need these even when a just-created property is renamed
      // before its creator's full context arrives
      const originals = context._originalValues as Record<string, unknown> | undefined
      if (next.modelName === undefined && originals?.modelName !== undefined) next.modelName = originals.modelName
      if (next.dataType === undefined && originals?.dataType !== undefined) next.dataType = originals.dataType
      const edited = differsFromOriginals(originals, next, event)
      return {
        ...next,
        ...(edited !== undefined && { _isEdited: edited }),
        _validationErrors: undefined,
      } as ModelPropertyMachineContext
    }),
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
    return context
  },
  on: {
    updateContext: [
      // A public change revalidates (then compareAndMarkDraft); an internal one is only applied
      { guard: ({ event }) => !isInternalUpdate(event), actions: 'applyUpdate', target: '.validating' },
      { actions: 'applyUpdate' },
    ],
    validateProperty: {
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
      // Note: State-specific transitions are handled in child states
      // This root handler ensures errors are always assigned to context
    },
    initializeOriginalValues: {
      actions: assign(({ context, event }) => ({
        ...context,
        _originalValues: event.originalValues,
        // Senders don't know the schema name; keep one setSchemaName already stored.
        _schemaName: event.schemaName ?? context._schemaName,
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
    // The property's row and schema file already have these values (e.g. after a schema update reloaded
    // them), so unlike updateContext it isn't an edit: no validation, draft marking or saveToSchema.
    syncedFromStorage: {
      actions: assign(({ context, event }) => ({
        ...event.values,
        _originalValues: context._originalValues
          ? { ...context._originalValues, ...event.values }
          : context._originalValues,
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
        saveToSchema: { target: 'saveToSchema' },
        validateProperty: {
          target: 'validating',
        },
      },
    },
    validating: {
      on: {
        saveToSchema: { target: 'saveToSchema' },
        validationSuccess: {
          target: 'compareAndMarkDraft',
          actions: assign(({ context }) => ({
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
        saveToSchema: { target: 'saveToSchema' },
        compareAndMarkDraftSuccess: {
          target: 'idle',
        },
        compareAndMarkDraftError: {
          target: 'idle',
        },
      },
      invoke: {
        src: 'compareAndMarkDraft',
        input: ({ context }) => ({ context }),
      },
    },
    saveToSchema: {
      // Gate the save in a transient child. An `always` on this parent targeting `.saving` re-enters
      // the invoking child on every microstep and never settles (save() ran the process out of memory).
      initial: 'checking',
      on: {
        // Apply updateContext but do not re-invoke saveToSchema actor (avoids infinite loop).
        // Context is updated; in-flight save completes with original context.
        // Applied without re-invoking saveToSchema (that looped); the save in flight keeps its context
        updateContext: { actions: 'applyUpdate' },
        // validationError: Uses root handler for assignment, but needs state-specific transition
        validationError: {
          target: 'idle',
          actions: 'assignValidationErrors',
        },
      },
      states: {
        checking: {
          always: [
            { guard: 'isPropertyValid', target: 'saving' },
            { target: '#modelProperty.idle' },
          ],
        },
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
