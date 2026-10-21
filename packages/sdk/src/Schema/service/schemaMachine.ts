import { assign, setup } from 'xstate'
import { SchemaFileFormat } from '@/types/import'
import { validateSchema } from './actors/validateSchema'
import { ValidationError } from '@/Schema/validation'
import { checkExistingSchema } from './actors/checkExistingSchema'
import { writeSchemaToDb } from './actors/writeSchemaToDb'

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
      nameMatch?: SchemaFileFormat['nameMatch']
      properties: {
        [propertyName: string]: any
      }
    }
  }
  enums?: {
    [enumName: string]: any
  }
  /** The schema file's top-level nameMatch (ADR 0009). */
  nameMatch?: SchemaFileFormat['nameMatch']
  migrations?: Array<{
    version: number
    timestamp: string
    description: string
    changes: any[]
  }>
  // Track if schema has unsaved changes
  _isDraft?: boolean
  // Track if schema has been edited locally (persisted in database)
  _isEdited?: boolean
  // Track which properties are edited (e.g., "ModelName:propertyName")
  _editedProperties?: Set<string>
  // Validation errors
  _validationErrors?: ValidationError[]
  id?: string // schemaFileId (string) - public ID
  _dbId?: number // Database integer ID - internal only
  // Conflict detection metadata - track when data was loaded from DB
  _loadedAt?: number // Timestamp when data was loaded from DB
  _dbVersion?: number // DB version at load time
  _dbUpdatedAt?: number // DB updatedAt timestamp at load time (milliseconds)
  // Store model IDs from liveQuery for reactive updates
  _liveQueryModelIds?: string[]
  _loadingStage?: string  // Current loading stage, for debugging
  _loadingError?: { stage: string; error: Error }  // Why loading failed
  _schemaRecord?: any  // Schema database record
  // Destroy failure from the last destroy() (read by destroy hooks)
  _destroyError?: { message: string; name?: string } | null
}

export const schemaMachine = setup({
  types: {
    context: {} as SchemaMachineContext,
    input: {} as Pick<SchemaMachineContext, 'schemaName'>,
    events: {} as
      | { type: 'updateContext'; [key: string]: any }
      | { type: 'markAsDraft'; propertyKey: string }
      | { type: 'clearDraft'; _dbUpdatedAt?: number; _dbVersion?: number }
      | { type: 'validateSchema' }
      | { type: 'validationSuccess'; errors: ValidationError[] }
      | { type: 'validationError'; errors: ValidationError[] }
      | { type: 'reloadFromDb' }
      // Staged loading events
      | { type: 'schemaFound'; schema: SchemaFileFormat; schemaRecord: any; modelIds?: string[]; loadedAt?: number; dbVersion?: number; dbUpdatedAt?: number }
      | { type: 'schemaNotFound' }
      | { type: 'loadError'; error: Error }
      | { type: 'schemaWritten'; schemaRecord: any; schema: SchemaFileFormat; modelIds?: string[] }
      | { type: 'writeError'; error: Error }
      | { type: 'destroyStarted' }
      | { type: 'destroyError'; error: unknown },
  },
  actors: {
    validateSchema,
    // Staged loading actors
    checkExistingSchema,
    writeSchemaToDb,
  },
  guards: {
    isSchemaValid: ({ context }) => {
      return !context._validationErrors || context._validationErrors.length === 0
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
    updateContext: [{
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
    }, {
      // Internal-only updates (e.g. the _dbUpdatedAt refresh after a draft save) are applied
      // without re-validating. Dropping them made the next save's conflict check compare
      // against a stale _dbUpdatedAt.
      actions: assign(({ context, event }) => {
        const newContext = Object.assign({}, context)
        for (const key of Object.keys(event)) {
          if (key.startsWith('_')) {
            ;(newContext as any)[key] = (event as any)[key]
          }
        }
        return newContext
      }),
    }],
    validateSchema: {
      target: '.validating',
    },
    validationSuccess: {
      actions: assign(({ context }) => ({
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
        _isEdited: true,
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
        newContext._isEdited = false
        newContext._editedProperties = new Set<string>()
        
        // Update conflict detection metadata if provided
        if ((event as any)._dbUpdatedAt !== undefined) {
          newContext._dbUpdatedAt = (event as any)._dbUpdatedAt
        }
        if ((event as any)._dbVersion !== undefined) {
          newContext._dbVersion = (event as any)._dbVersion
        }
        // saveNewVersion passes the schema it just wrote: the instance now is that version.
        const saved = (event as any).savedSchema as
          | Pick<SchemaFileFormat, 'version' | 'metadata' | 'migrations'>
          | undefined
        if (saved) {
          newContext.version = saved.version
          newContext.metadata = saved.metadata
          newContext.migrations = saved.migrations
        }
        
        return newContext
      }),
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
      initial: 'checkingExisting',
      states: {
        // Stage 0: Check for existing schema
        checkingExisting: {
          invoke: {
            src: 'checkExistingSchema',
            input: ({ context }) => ({ context }),
          },
          on: {
            schemaFound: {
              target: '#schema.idle',
              actions: assign(({ event }) => {
                return {
                  schemaName: event.schema.metadata.name,
                  $schema: event.schema.$schema,
                  version: event.schema.version,
                  metadata: event.schema.metadata,
                  models: event.schema.models,
                  enums: event.schema.enums,
                  migrations: event.schema.migrations,
                  nameMatch: event.schema.nameMatch,
                  _isDraft: false,
                  _isEdited: event.schemaRecord?.isEdited ?? false,
                  _editedProperties: new Set<string>(),
                  _validationErrors: undefined,
                  id: event.schema.id, // schemaFileId (string)
                  _dbId: event.schemaRecord?.id, // Database integer ID
                  _loadedAt: event.loadedAt,
                  _dbVersion: event.dbVersion,
                  _dbUpdatedAt: event.dbUpdatedAt,
                  _liveQueryModelIds: event.modelIds || [],
                  _schemaRecord: event.schemaRecord,
                }
              }),
            },
            schemaNotFound: {
              target: 'writingSchema',
            },
            loadError: {
              target: '#schema.error',
              actions: assign({
                _loadingError: ({ event }) => ({ stage: 'checkingExisting', error: event.error }),
              }),
            },
          },
        },
        // No row or file of this name: create it
        writingSchema: {
          entry: assign({
            _loadingStage: 'writingSchema',
          }),
          invoke: {
            src: 'writeSchemaToDb',
            input: ({ context }) => ({
              schemaName: context.schemaName,
            }),
          },
          on: {
            schemaWritten: {
              target: '#schema.idle',
              actions: assign({
                _schemaRecord: ({ event }) => event.schemaRecord,
                id: ({ event }) => event.schema.id, // schemaFileId (string)
                _dbId: ({ event }) => event.schemaRecord?.id, // Database integer ID
                // A schema created in code has these only in the written record; without them
                // validation (and so saveNewVersion) failed with "Schema metadata is required".
                $schema: ({ context, event }) => context.$schema ?? event.schema.$schema,
                version: ({ context, event }) => context.version ?? event.schema.version,
                metadata: ({ context, event }) => context.metadata ?? event.schema.metadata,
                enums: ({ context, event }) => context.enums ?? event.schema.enums,
                migrations: ({ context, event }) => context.migrations ?? event.schema.migrations,
                nameMatch: ({ context, event }) => context.nameMatch ?? event.schema.nameMatch,
                models: ({ context, event }) => context.models ?? event.schema.models,
                _liveQueryModelIds: ({ event }) => event.modelIds ?? [],
                _loadingStage: undefined,
              }),
            },
            writeError: {
              target: '#schema.error',
              actions: assign({
                _loadingError: ({ event }) => ({
                  stage: 'writingSchema',
                  error: event.error,
                }),
              }),
            },
          },
        },
      },
    },
    idle: {
      on: {
        validateSchema: {
          target: 'validating',
        },
        reloadFromDb: {
          target: 'loading',
        },
      },
      // No `always: hasValidationErrors -> validating` here: validation is re-run when the context changes
      // (updateContext) or on request (validateSchema). Re-entering while errors exist would loop
      // forever on a schema that is still invalid.
    },
    validating: {
      on: {
        // These state-level handlers take precedence over the root ones, so they must store the result
        // themselves.
        validationSuccess: {
          target: 'idle',
          actions: assign(({ context }) => ({
            ...context,
            _validationErrors: [],
          })),
        },
        validationError: {
          target: 'idle',
          actions: assign(({ context, event }) => ({
            ...context,
            _validationErrors: event.errors,
          })),
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
