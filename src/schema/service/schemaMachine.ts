import { assign, setup, ActorRefFrom } from 'xstate'
import { SchemaFileFormat } from '@/types/import'
import { loadOrCreateSchema } from './actors/loadOrCreateSchema'
import { validateSchema } from './actors/validateSchema'
import { ValidationError } from '@/Schema/validation'
import { addModelsMachine } from './addModelsMachine'
import { writeProcessMachine } from '@/services/write/writeProcessMachine'

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
      properties: {
        [propertyName: string]: any
      }
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
  // Conflict detection metadata - track when data was loaded from DB
  _loadedAt?: number // Timestamp when data was loaded from DB
  _dbVersion?: number // DB version at load time
  _dbUpdatedAt?: number // DB updatedAt timestamp at load time (milliseconds)
  // Model addition queue and tracking
  _pendingModelAdditions?: Array<{ models: { [modelName: string]: any }; timestamp: number }>
  _modelAdditionErrors?: Array<{ error: Error; timestamp: number }>
  writeProcess?: ActorRefFrom<typeof writeProcessMachine> | null
  // Store model IDs from liveQuery for reactive updates
  _liveQueryModelIds?: string[]
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
      | { type: 'clearDraft'; _dbUpdatedAt?: number; _dbVersion?: number }
      | { type: 'validateSchema' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] }
      | { type: 'reloadFromDb' }
      | { type: 'addModels'; models: { [modelName: string]: any } }
      | { type: 'requestWrite'; data: any },
  },
  actors: {
    loadOrCreateSchema,
    validateSchema,
    addModelsMachine,
    writeProcessMachine,
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
    _liveQueryModelIds: [],
  }),
  on: {
    updateContext: {
      actions: assign(({ context, event }) => {
        const newContext = Object.assign({}, context)

        // Check if this is only updating internal fields
        const onlyInternalFields = Object.keys(event).every((key: string) => {
          return key === 'type' || key.startsWith('_')
        })

        for (let i = 0; i < Object.keys(event).length; i++) {
          const key = Object.keys(event)[i]
          if (key === 'type') {
            continue
          }
          if (key in newContext || key.startsWith('_')) {
            ;(newContext as any)[key] = event[key]
          }
        }
        // Clear validation errors on context update (will be re-validated if needed)
        newContext._validationErrors = undefined
        
        // Trigger validation if updating non-internal fields
        if (!onlyInternalFields) {
          // Validation will be triggered by the guard below
        }
        
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
      actions: assign(({ context, event }) => {
        const newContext = { ...context }
        newContext._isDraft = false
        newContext._editedProperties = new Set<string>()
        
        // Update conflict detection metadata if provided
        if ((event as any)._dbUpdatedAt !== undefined) {
          newContext._dbUpdatedAt = (event as any)._dbUpdatedAt
        }
        if ((event as any)._dbVersion !== undefined) {
          newContext._dbVersion = (event as any)._dbVersion
        }
        
        return newContext
      }),
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
              // Conflict detection metadata - will be set by loadOrCreateSchema actor
              _loadedAt: (event as any).loadedAt,
              _dbVersion: (event as any).dbVersion,
              _dbUpdatedAt: (event as any).dbUpdatedAt,
              _liveQueryModelIds: (event as any)._liveQueryModelIds || [], // Use model IDs from loadOrCreateSchema, or empty array if not provided
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
      entry: assign({
        writeProcess: ({ spawn, context }) => {
          if (!context.writeProcess && context._schemaFileId) {
            return spawn(writeProcessMachine, {
              input: {
                entityType: 'schema',
                entityId: context._schemaFileId,
                entityData: {
                  name: context.schemaName,
                  $schema: context.$schema,
                  version: context.version,
                  metadata: context.metadata,
                  models: context.models,
                  enums: context.enums,
                  migrations: context.migrations,
                },
              },
            })
          }
          return context.writeProcess
        },
      }),
      on: {
        addModels: {
          target: 'addingModels',
        },
        validateSchema: {
          target: 'validating',
        },
        reloadFromDb: {
          target: 'loading',
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
      always: {
        guard: 'hasValidationErrors',
        target: 'validating',
      },
    },
    addingModels: {
      entry: assign({
        // Move first pending item to current if not already set
        _pendingModelAdditions: ({ context, event }) => {
          const pending = context._pendingModelAdditions || []
          // If event has models, it's a new request - add to queue if we're already processing
          if ((event as any).models) {
            return [
              ...pending,
              {
                models: (event as any).models,
                timestamp: Date.now(),
              },
            ]
          }
          return pending
        },
      }),
      invoke: {
        src: 'addModelsMachine',
        input: ({ context }) => {
          // Get models from first item in pending queue, or from context if queue is empty
          const pending = context._pendingModelAdditions || []
          const models = pending.length > 0 ? pending[0].models : {}
          return {
            schemaContext: context,
            models,
            existingModels: context.models || {},
          }
        },
        onDone: {
          actions: [
            assign({
              models: ({ context, event }) => {
                const addedModels = (event.output as any)?.addedModels || {}
                return {
                  ...(context.models || {}),
                  ...addedModels,
                }
              },
              _pendingModelAdditions: ({ context }) => {
                // Remove first item from queue (the one we just processed)
                const pending = context._pendingModelAdditions || []
                return pending.length > 1 ? pending.slice(1) : undefined
              },
            }),
            // Trigger validation after models are added
            ({ self }) => {
              self.send({ type: 'validateSchema' })
            },
          ],
        },
        onError: {
          actions: assign({
            _modelAdditionErrors: ({ context, event }) => {
              const existing = context._modelAdditionErrors || []
              return [
                ...existing,
                {
                  error: event.error instanceof Error ? event.error : new Error(String(event.error)),
                  timestamp: Date.now(),
                },
              ]
            },
            _pendingModelAdditions: ({ context }) => {
              // Remove first item from queue even on error, so we can process next
              const pending = context._pendingModelAdditions || []
              return pending.length > 1 ? pending.slice(1) : undefined
            },
          }),
        },
      },
      on: {
        // Queue additional requests while processing
        addModels: {
          actions: assign({
            _pendingModelAdditions: ({ context, event }) => {
              const existing = context._pendingModelAdditions || []
              return [
                ...existing,
                {
                  models: (event as any).models,
                  timestamp: Date.now(),
                },
              ]
            },
          }),
        },
      },
      always: [
        {
          // If there are pending additions after processing, process next one
          guard: ({ context }) => {
            const pending = context._pendingModelAdditions || []
            return pending.length > 0
          },
          target: 'addingModels',
        },
        {
          // No more pending, return to idle
          target: 'idle',
        },
      ],
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
