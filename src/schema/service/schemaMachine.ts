import { assign, setup } from 'xstate'
import { SchemaFileFormat } from '@/types/import'
import { loadOrCreateSchema } from './actors/loadOrCreateSchema'
import { validateSchema } from './actors/validateSchema'
import { ValidationError } from '@/schema/validation'

export type SchemaMachineContext = {
  schemaName: string
  $schema?: string
  version?: number
  metadata?: {
    name: string
    createdAt: string
    updatedAt: string
  }
  models?: {
    [modelName: string]: {
      description?: string
      properties: {
        [propertyName: string]: any
      }
      indexes?: string[]
    }
  }
  enums?: {
    [enumName: string]: any
  }
  migrations?: Array<{
    version: number
    timestamp: string
    description: string
    changes: any[]
  }>
  // Track if schema has unsaved changes
  _isDraft?: boolean
  // Track which properties are edited (e.g., "ModelName:propertyName")
  _editedProperties?: Set<string>
  // Validation errors
  _validationErrors?: ValidationError[]
  // Store schemaFileId for database lookups (independent of name changes)
  _schemaFileId?: string
}

export const schemaMachine = setup({
  types: {
    context: {} as SchemaMachineContext,
    input: {} as Pick<SchemaMachineContext, 'schemaName'>,
    events: {} as
      | { type: 'updateContext'; [key: string]: any }
      | { type: 'loadOrCreateSchema' }
      | { type: 'loadOrCreateSchemaSuccess'; schema: SchemaFileFormat }
      | { type: 'loadOrCreateSchemaError'; error: Error }
      | { type: 'markAsDraft'; propertyKey: string }
      | { type: 'clearDraft' }
      | { type: 'validateSchema' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] },
  },
  actors: {
    loadOrCreateSchema,
    validateSchema,
  },
  guards: {
    isSchemaValid: ({ context }) => {
      return !context._validationErrors || context._validationErrors.length === 0
    },
    hasValidationErrors: ({ context }) => {
      return !!context._validationErrors && context._validationErrors.length > 0
    },
  },
}).createMachine({
  id: 'schema',
  initial: 'loading',
  context: ({ input }) => ({
    schemaName: input.schemaName,
    _isDraft: false,
    _editedProperties: new Set<string>(),
    _validationErrors: undefined,
  }),
  on: {
    updateContext: {
      actions: assign(({ context, event }) => {
        const newContext = Object.assign({}, context)

        for (let i = 0; i < Object.keys(event).length; i++) {
          const key = Object.keys(event)[i]
          if (key === 'type') {
            continue
          }
          newContext[key as keyof SchemaMachineContext] = event[key]
        }
        // Clear validation errors on context update (will be re-validated if needed)
        newContext._validationErrors = undefined
        return newContext
      }),
    },
    validateSchema: {
      target: '.validating',
    },
    validationSuccess: {
      actions: assign(({ context, event }) => ({
        ...context,
        _validationErrors: [],
      })),
    },
    validationError: {
      actions: assign(({ context, event }) => ({
        ...context,
        _validationErrors: event.errors,
      })),
    },
    markAsDraft: {
      actions: assign(({ context, event }) => ({
        ...context,
        _isDraft: true,
        _editedProperties: new Set([
          ...(context._editedProperties || []),
          event.propertyKey,
        ]),
      })),
    },
    clearDraft: {
      actions: assign(({ context }) => ({
        ...context,
        _isDraft: false,
        _editedProperties: new Set<string>(),
      })),
    },
  },
  states: {
    loading: {
      on: {
        loadOrCreateSchemaSuccess: {
          target: 'idle',
          actions: assign(({ event }) => {
            return {
              schemaName: event.schema.metadata.name,
              $schema: event.schema.$schema,
              version: event.schema.version,
              metadata: event.schema.metadata,
              models: event.schema.models,
              enums: event.schema.enums,
              migrations: event.schema.migrations,
              _isDraft: false,
              _editedProperties: new Set<string>(),
              _validationErrors: undefined,
              _schemaFileId: event.schema.id, // Store schemaFileId for database lookups
            }
          }),
        },
        loadOrCreateSchemaError: {
          target: 'error',
        },
      },
      invoke: {
        src: 'loadOrCreateSchema',
        input: ({ context }) => ({ context }),
      },
    },
    idle: {
      on: {
        validateSchema: {
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
        },
        validationError: {
          target: 'idle',
        },
      },
      invoke: {
        src: 'validateSchema',
        input: ({ context }) => ({ context }),
      },
    },
    error: {},
  },
})
