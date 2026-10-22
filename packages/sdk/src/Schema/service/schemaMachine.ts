import { assign, fromPromise, setup } from 'xstate'
import { SchemaFileFormat } from '@/types/import'
import { ValidationError } from '@/Schema/validation'
import { loadOrCreateSchema, type LoadedSchema } from '../loadOrCreateSchema'
import { SchemaValidationService } from './validation/SchemaValidationService'

const validationService = new SchemaValidationService()

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
      | { type: 'reloadFromDb' }
      | { type: 'destroyStarted' }
      | { type: 'destroyError'; error: unknown },
  },
  actors: {
    loadOrCreateSchema: fromPromise<LoadedSchema, { schemaName: string }>(({ input }) =>
      loadOrCreateSchema(input.schemaName),
    ),
  },
  actions: {
    // Validation is synchronous: the result is in the context as soon as the event is handled
    validate: assign(({ context }) => {
      try {
        return { _validationErrors: validationService.validateSchema(context).errors }
      } catch (error) {
        return {
          _validationErrors: [{
            field: 'schema',
            message: error instanceof Error ? error.message : 'Unknown validation error',
            code: 'validation_exception',
            severity: 'error' as const,
          }],
        }
      }
    }),
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
      actions: [assign(({ context, event }) => {
        const newContext = Object.assign({}, context)
        for (let i = 0; i < Object.keys(event).length; i++) {
          const key = Object.keys(event)[i]
          if (key === 'type') {
            continue
          }
          if (key in newContext || key.startsWith('_')) {
            ;(newContext as any)[key] = event[key]
          }
        }
        return newContext
      }), 'validate'],
      // Only validate when updating non-internal fields
      guard: ({ event }: { event: any }) => {
        return !Object.keys(event).every((key: string) => {
          return key === 'type' || key.startsWith('_')
        })
      },
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
      actions: 'validate',
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
      invoke: {
        src: 'loadOrCreateSchema',
        input: ({ context }) => ({ schemaName: context.schemaName }),
        onDone: [
          {
            // Created at runtime: what code already set wins over the new record's defaults
            guard: ({ event }) => event.output.created,
            target: 'idle',
            actions: assign(({ context, event }) => {
              const { schema, schemaRecord, modelIds } = event.output
              return {
                _schemaRecord: schemaRecord,
                id: schema.id, // schemaFileId (string)
                _dbId: schemaRecord?.id, // Database integer ID
                $schema: context.$schema ?? schema.$schema,
                version: context.version ?? schema.version,
                metadata: context.metadata ?? schema.metadata,
                enums: context.enums ?? schema.enums,
                migrations: context.migrations ?? schema.migrations,
                nameMatch: context.nameMatch ?? schema.nameMatch,
                models: context.models ?? schema.models,
                _liveQueryModelIds: modelIds,
              }
            }),
          },
          {
            target: 'idle',
            actions: assign(({ event }) => {
              const { schema, schemaRecord, modelIds, loadedAt, dbVersion, dbUpdatedAt } = event.output
              return {
                schemaName: schema.metadata.name,
                $schema: schema.$schema,
                version: schema.version,
                metadata: schema.metadata,
                models: schema.models,
                enums: schema.enums,
                migrations: schema.migrations,
                nameMatch: schema.nameMatch,
                _isDraft: false,
                _isEdited: schemaRecord?.isEdited ?? false,
                _editedProperties: new Set<string>(),
                _validationErrors: undefined,
                id: schema.id, // schemaFileId (string)
                _dbId: schemaRecord?.id, // Database integer ID
                _loadedAt: loadedAt,
                _dbVersion: dbVersion,
                _dbUpdatedAt: dbUpdatedAt,
                _liveQueryModelIds: modelIds,
                _schemaRecord: schemaRecord,
              }
            }),
          },
        ],
        onError: {
          target: 'error',
          actions: assign({
            _loadingError: ({ event }) => ({
              stage: 'loading',
              error: event.error instanceof Error ? event.error : new Error(String(event.error)),
            }),
          }),
        },
      },
    },
    idle: {
      on: {
        reloadFromDb: {
          target: 'loading',
        },
      },
    },
    error: {},
  },
})
