# Database Write Refactoring Implementation Plan

## Overview

This plan outlines the refactoring to:
1. Remove registration methods (`_registerModelInstance`, `_registerPropertyInstance`)
2. Use database + liveQuery as the source of truth for relationships
3. Implement stateful write processes with validation and error handling

## Architecture Principles

### Core Principles
- **Database as Source of Truth**: Relationships defined in DB (join tables), not in-memory registration
- **Unidirectional Data Flow**: Entity → DB → LiveQuery → Parent Entity
- **Optimistic Updates**: Instances available immediately, DB writes happen asynchronously
- **Stateful Write Process**: All DB writes managed by XState machines with validation and error handling

### Entity Relationships
- **Schema ↔ Models**: Via `model_schemas` join table
- **Model ↔ ModelProperties**: Via `properties` table (modelId foreign key)
- **ModelProperty**: Standalone entity, linked to Model via `modelId`

---

## Phase 1: Stateful Write Process Infrastructure

### 1.1 Create Write Process Machine

**File**: `src/services/write/writeProcessMachine.ts`

Create a reusable XState machine for managing entity writes:

```typescript
type WriteProcessContext = {
  entityType: 'model' | 'modelProperty' | 'schema'
  entityId: string
  entityData: any
  validationErrors: ValidationError[]
  writeStatus: 'idle' | 'validating' | 'writing' | 'success' | 'error'
  error: Error | null
  retryCount: number
  pendingWrite: {
    data: any
    timestamp: number
  } | null
}

type WriteProcessEvent = 
  | { type: 'startWrite'; data: any }
  | { type: 'validate' }
  | { type: 'write' }
  | { type: 'writeSuccess' }
  | { type: 'writeError'; error: Error }
  | { type: 'retry' }
  | { type: 'revert' }
  | { type: 'reset' }

const writeProcessMachine = setup({
  types: {
    context: {} as WriteProcessContext,
    input: {} as Partial<WriteProcessContext>,
  },
  actors: {
    validateEntity,
    writeToDatabase,
  },
}).createMachine({
  id: 'writeProcess',
  initial: 'idle',
  context: ({ input }) => ({
    entityType: input.entityType!,
    entityId: input.entityId!,
    entityData: input.entityData || {},
    validationErrors: [],
    writeStatus: 'idle',
    error: null,
    retryCount: 0,
    pendingWrite: null,
  }),
  states: {
    idle: {
      on: {
        startWrite: {
          target: 'validating',
          actions: assign({
            pendingWrite: ({ event }) => ({
              data: event.data,
              timestamp: Date.now(),
            }),
          }),
        },
      },
    },
    validating: {
      invoke: {
        src: 'validateEntity',
        input: ({ context }) => ({
          entityType: context.entityType,
          entityData: context.pendingWrite?.data || context.entityData,
        }),
        onDone: {
          target: 'writing',
          actions: assign({
            validationErrors: ({ event }) => event.output.errors || [],
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error,
            writeStatus: 'error',
          }),
        },
      },
    },
    writing: {
      invoke: {
        src: 'writeToDatabase',
        input: ({ context }) => ({
          entityType: context.entityType,
          entityId: context.entityId,
          entityData: context.pendingWrite?.data || context.entityData,
        }),
        onDone: {
          target: 'success',
          actions: assign({
            writeStatus: 'success',
            pendingWrite: null,
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error,
            writeStatus: 'error',
            retryCount: ({ context }) => context.retryCount + 1,
          }),
        },
      },
    },
    success: {
      after: {
        2000: { target: 'idle' }, // Auto-reset after 2s
      },
      on: {
        reset: 'idle',
      },
    },
    error: {
      on: {
        retry: {
          target: 'validating',
          guard: ({ context }) => context.retryCount < 3,
          actions: assign({
            error: null,
          }),
        },
        revert: {
          target: 'idle',
          actions: assign({
            pendingWrite: null,
            writeStatus: 'idle',
            error: null,
          }),
        },
        reset: 'idle',
      },
    },
  },
})
```

### 1.2 Create Write Process Actors

**File**: `src/services/write/actors/validateEntity.ts`

```typescript
export const validateEntity = fromCallback<
  EventObject,
  { entityType: string; entityData: any }
>(({ sendBack, input }) => {
  const _validate = async () => {
    // Import validation based on entity type
    if (input.entityType === 'model') {
      const { validateModel } = await import('@/Model/validation')
      return validateModel(input.entityData)
    } else if (input.entityType === 'modelProperty') {
      const { validateModelProperty } = await import('@/ModelProperty/validation')
      return validateModelProperty(input.entityData)
    }
    // ... other entity types
    return { isValid: true, errors: [] }
  }
  
  _validate().then((result) => {
    if (result.isValid) {
      sendBack({ type: 'validateSuccess', errors: [] })
    } else {
      sendBack({ type: 'validateError', errors: result.errors })
    }
  })
})
```

**File**: `src/services/write/actors/writeToDatabase.ts`

```typescript
export const writeToDatabase = fromCallback<
  EventObject,
  { entityType: string; entityId: string; entityData: any }
>(({ sendBack, input }) => {
  const _write = async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const db = BaseDb.getAppDb()
    if (!db) {
      throw new Error('Database not available')
    }
    
    if (input.entityType === 'model') {
      const { writeModelToDb } = await import('@/helpers/db')
      await writeModelToDb(input.entityId, input.entityData)
    } else if (input.entityType === 'modelProperty') {
      const { writePropertyToDb } = await import('@/helpers/db')
      await writePropertyToDb(input.entityId, input.entityData)
    }
    // ... other entity types
  }
  
  _write()
    .then(() => sendBack({ type: 'writeSuccess' }))
    .catch((error) => sendBack({ type: 'writeError', error }))
})
```

### 1.3 Integrate Write Process into Entity Services

**Files**: 
- `src/Model/service/modelMachine.ts`
- `src/ModelProperty/service/modelPropertyMachine.ts`
- `src/Schema/service/schemaMachine.ts`

Add write process as spawned actor:

```typescript
// In modelMachine.ts
context: {
  // ... existing context
  writeProcess: null as ActorRefFrom<typeof writeProcessMachine> | null,
}

states: {
  idle: {
    entry: assign({
      writeProcess: ({ spawn }) => spawn(writeProcessMachine, {
        input: {
          entityType: 'model',
          entityId: ({ context }) => context._modelFileId || '',
        },
      }),
    }),
    on: {
      requestWrite: {
        actions: ({ context, event }) => {
          context.writeProcess?.send({
            type: 'startWrite',
            data: event.data,
          })
        },
      },
    },
  },
}
```

---

## Phase 2: Schema → Models Refactoring

### 2.1 Remove Registration and Cache Management Code

**File**: `src/Schema/Schema.ts`

**Remove Methods**:
- `_registerModelInstance()` method (~360 lines)
- `_updateModelInstances()` method (~270 lines)

**Remove from `schemaInstanceState` WeakMap**:
- `modelInstancesById: Map<string, Model>` - No longer needed, use Model static cache
- `modelNameToId: Map<string, string>` - No longer needed
- `modelInstances: Map<string, Model>` - Legacy cache, remove
- `_updateModelInstancesInProgress: boolean` - No longer needed
- `_recentlyRegisteredModels: Map<string, number>` - No longer needed
- `lastModelsHash: string | null` - No longer needed for tracking model changes

**Update `schemaInstanceState` type** to:
```typescript
const schemaInstanceState = new WeakMap<Schema, {
  lastContextUpdate: number
  contextUpdateTimeout: ReturnType<typeof setTimeout> | null
  lastContextHash: string | null
  cacheKeyUpdated: boolean
  isClientInitialized: boolean | null
  liveQuerySubscription: { unsubscribe: () => void } | null
  liveQueryModelIds: string[] // NEW: Store model IDs from liveQuery
}>()
```

**Remove from Schema Context**:
- `models` object data - Remove entirely, only return Model instances from getContext()
- All logic that updates `context.models` from model data

**Remove Subscription Logic**:
- Remove the subscription handler that calls `_updateModelInstances()` when `lastModelsHash` changes
- Remove checks for `_recentlyRegisteredModels` and `_updateModelInstancesInProgress`
- Remove `lastModelsHash` comparison logic

**Update `unload()` Method**:
- Remove cleanup of `modelInstancesById`, `modelNameToId`, `modelInstances` Maps
- Remove cleanup of `_recentlyRegisteredModels`

### 2.2 Update Model.create() to Write to DB

**File**: `src/Model/Model.ts`

**Changes**:

1. **Remove registration callback**:
   ```typescript
   // REMOVE this entire block:
   if (registerWithSchema && schemaInstance) {
     queueMicrotask(async () => {
       // ... registration logic
     })
   }
   ```

2. **Add DB write logic**:
   ```typescript
   static create(modelName, schemaNameOrSchema, options) {
     // ... existing cache checks and instance creation ...
     
     // If schema provided, trigger write process
     if (schemaInstance) {
       const schemaId = await getSchemaId(schemaInstance)
       
       // Track pending write
       Model.trackPendingWrite(modelFileId, schemaId)
       
       // Trigger write process via service
       proxiedInstance._service.send({
         type: 'requestWrite',
         data: {
           modelFileId,
           modelName,
           schemaName,
           schemaId,
           properties: options?.properties,
           indexes: options?.indexes,
           description: options?.description,
         },
       })
     }
     
     return proxiedInstance
   }
   ```

3. **Add pending write tracking**:
   ```typescript
   // Static tracking for pending writes
   private static pendingWrites = new Map<string, {
     modelFileId: string
     schemaId: number
     status: 'pending' | 'writing' | 'success' | 'error'
     timestamp: number
   }>()
   
   static trackPendingWrite(modelFileId: string, schemaId: number): void {
     this.pendingWrites.set(modelFileId, {
       modelFileId,
       schemaId,
       status: 'pending',
       timestamp: Date.now(),
     })
   }
   
   static getPendingModelIds(schemaId: number): string[] {
     return Array.from(this.pendingWrites.entries())
       .filter(([_, write]) => write.schemaId === schemaId && write.status !== 'error')
       .map(([modelFileId]) => modelFileId)
   }
   ```

### 2.3 Update Schema LiveQuery

**File**: `src/Schema/Schema.ts`

**Update `_setupLiveQuerySubscription()`**:

```typescript
const models$ = BaseDb.liveQuery<{ 
  modelId: number
  modelName: string
  modelFileId: string  // ADD THIS
}>(
  (sql: any) => sql`
    SELECT 
      ms.model_id as modelId,
      m.name as modelName,
      m.schema_file_id as modelFileId
    FROM model_schemas ms
    INNER JOIN models m ON ms.model_id = m.id
    WHERE ms.schema_id = ${schemaId}
  `
)
```

**Update subscription handler**:

```typescript
const subscription = models$.subscribe({
  next: (modelRows) => {
    // Store model IDs in instanceState
    const instanceState = schemaInstanceState.get(this)
    if (instanceState) {
      instanceState.liveQueryModelIds = modelRows.map(row => row.modelFileId)
    }
    
    // Trigger context update (will call getContext())
    this._service.send({
      type: 'updateContext',
      _modelsUpdated: Date.now(), // Internal field
    })
  },
})
```

### 2.4 Update Schema.getContext()

**File**: `src/Schema/Schema.ts`

**Replace `getContext()` implementation**:

```typescript
getContext: () => {
  const context = newInstance._getSnapshotContext()
  const instanceState = schemaInstanceState.get(newInstance)
  
  // Get schema ID for pending writes lookup
  const schemaId = context._schemaFileId 
    ? await getSchemaIdByFileId(context._schemaFileId)
    : await getSchemaId(context.schemaName)
  
  // Get model IDs from liveQuery
  const liveQueryIds = instanceState?.liveQueryModelIds || []
  
  // Get pending model IDs (not yet in DB)
  const pendingIds = Model.getPendingModelIds(schemaId)
  
  // Combine and deduplicate
  const allModelIds = [...new Set([...liveQueryIds, ...pendingIds])]
  
  // Get Model instances from static cache
  const modelInstances: Model[] = []
  for (const modelFileId of allModelIds) {
    const model = Model.getById(modelFileId)
    if (model) {
      modelInstances.push(model)
    } else {
      // Model not in cache yet - create it (will load from DB)
      // This handles the case where liveQuery sees it but cache doesn't
      const created = await Model.createById(modelFileId)
      if (created) {
        modelInstances.push(created)
      }
    }
  }
  
  return {
    ...context,
    // Remove models data from context - only return instances
    models: [...modelInstances], // New array reference for React
  }
}
```

**Remove all references to**:
- `instanceState.modelInstancesById`
- `instanceState.modelNameToId`
- `instanceState.modelInstances`
- `instanceState._updateModelInstancesInProgress`
- `instanceState._recentlyRegisteredModels`
- `instanceState.lastModelsHash`

### 2.5 Remove Model Data from Schema Context

**File**: `src/Schema/service/schemaMachine.ts`

- Remove `models` from `SchemaMachineContext` type
- Or keep as optional `modelIds: string[]` (but liveQuery provides this)

---

## Phase 3: Model → ModelProperties Refactoring

### 3.1 Remove Registration and Cache Management Code

**File**: `src/Model/Model.ts`

**Remove Methods**:
- `_registerPropertyInstance()` method
- `_updatePropertiesFromDb()` method (~70 lines)
- `_getRegisteredPropertyInstances()` method

**Remove from `modelInstanceState` WeakMap**:
- `propertyInstancesById: Map<number, any>` - No longer needed, use ModelProperty static cache
- `propertyNameToId: Map<string, number>` - No longer needed

**Update `modelInstanceState` type** to:
```typescript
const modelInstanceState = new WeakMap<Model, {
  liveQuerySubscription: { unsubscribe: () => void } | null
  liveQueryPropertyIds: string[] // NEW: Store property IDs from liveQuery
}>()
```

**Remove from Model Context**:
- `properties` object data - Remove from context, only build from ModelProperty instances in getter
- All logic that updates `context.properties` from property data

**Update `destroy()` Method**:
- Remove cleanup of `propertyInstancesById` and `propertyNameToId` Maps
- Remove iteration through `propertyInstancesById` to unload properties
- Properties are managed by ModelProperty static cache, no cleanup needed here

**Update `_buildPropertiesFromInstances()` Method**:
- This method can be removed entirely - properties getter will build from ModelProperty instances directly
- Or keep it but update to use ModelProperty static cache instead of instanceState cache

### 3.2 Update ModelProperty.create() to Write to DB

**File**: `src/ModelProperty/ModelProperty.ts`

**Changes**:

1. **Add DB write logic**:
   ```typescript
   static create(property: Static<typeof TProperty>): ModelProperty {
     // ... existing cache checks and instance creation ...
     
     // Generate propertyFileId if not provided
     const propertyFileId = property.id || generateId()
     
     // If modelId provided, trigger write process
     if (property.modelId || property.modelName) {
       const modelId = property.modelId || await getModelId(property.modelName)
       
       // Track pending write
       ModelProperty.trackPendingWrite(propertyFileId, modelId)
       
       // Trigger write process via service
       proxiedInstance._service.send({
         type: 'requestWrite',
         data: {
           propertyFileId,
           modelId,
           propertyData: property,
         },
       })
     }
     
     return proxiedInstance
   }
   ```

2. **Add pending write tracking** (similar to Model)

### 3.3 Update Model LiveQuery

**File**: `src/Model/Model.ts`

**Update `_setupLiveQuerySubscription()`**:

```typescript
const properties$ = BaseDb.liveQuery<{ 
  id: number
  name: string
  propertyFileId: string  // ADD THIS (schema_file_id column)
  modelId: number
  dataType: string
  // ... other fields
}>(
  (sql) => sql`
    SELECT 
      id,
      name,
      schema_file_id as propertyFileId,
      model_id as modelId,
      data_type as dataType,
      -- ... other fields
    FROM properties
    WHERE model_id = ${modelId}
  `
)
```

**Update subscription handler**:

```typescript
const subscription = properties$.subscribe({
  next: (propertyRows) => {
    // Store property IDs in instanceState
    const instanceState = modelInstanceState.get(this)
    if (instanceState) {
      instanceState.liveQueryPropertyIds = propertyRows.map(row => row.propertyFileId)
    }
    
    // Trigger context update (for React reactivity)
    this._service.send({
      type: 'updateContext',
      _propertiesUpdated: Date.now(), // Internal field
    })
  },
})
```

**Remove `_updatePropertiesFromDb()` method**:
- This method is no longer needed - liveQuery subscription just stores IDs
- Properties are loaded on-demand from ModelProperty static cache when accessed

### 3.4 Update Model.properties Getter

**File**: `src/Model/Model.ts`

**Update Proxy getter for `properties`**:

```typescript
// In Model.create() proxy
get(target, prop: string | symbol) {
  if (prop === 'properties') {
    const instanceState = modelInstanceState.get(newInstance)
    const context = newInstance._getSnapshotContext()
    
    // Get modelId for pending writes lookup
    const modelId = context.modelId || await getModelId(context.modelName)
    
    // Get property IDs from liveQuery
    const liveQueryIds = instanceState?.liveQueryPropertyIds || []
    
    // Get pending property IDs
    const pendingIds = ModelProperty.getPendingPropertyIds(modelId)
    
    // Combine and deduplicate
    const allPropertyIds = [...new Set([...liveQueryIds, ...pendingIds])]
    
    // Get ModelProperty instances from static cache
    const propertyInstances: ModelProperty[] = []
    for (const propertyFileId of allPropertyIds) {
      const property = ModelProperty.getById(propertyFileId)
      if (property) {
        propertyInstances.push(property)
      } else {
        // Property not in cache - create it (will load from DB)
        const created = await ModelProperty.createById(propertyFileId)
        if (created) {
          propertyInstances.push(created)
        }
      }
    }
    
    // Convert to properties object format
    const propertiesObj: { [name: string]: any } = {}
    for (const propInstance of propertyInstances) {
      const propContext = propInstance._getSnapshotContext()
      if (propContext.name) {
        propertiesObj[propContext.name] = {
          dataType: propContext.dataType,
          ref: propContext.ref,
          refModelName: propContext.refModelName,
          // ... other fields
        }
      }
    }
    
    return propertiesObj
  }
  
  // ... other property handlers
}
```

**Remove all references to**:
- `instanceState.propertyInstancesById`
- `instanceState.propertyNameToId`
- `_registerPropertyInstance()` calls
- `_updatePropertiesFromDb()` method
- `_getRegisteredPropertyInstances()` method

### 3.5 Remove Property Data from Model Context

**File**: `src/Model/service/modelMachine.ts`

- Remove `properties` object from `ModelMachineContext`
- Or keep as optional `propertyIds: string[]` (but liveQuery provides this)

---

## Phase 4: Helper Functions

### 4.1 Create DB Write Helpers

**File**: `src/helpers/db.ts`

Add new functions:

```typescript
/**
 * Write model to database and create model_schemas join entry
 */
export async function writeModelToDb(
  modelFileId: string,
  data: {
    modelName: string
    schemaId: number
    properties?: { [name: string]: any }
    indexes?: string[]
    description?: string
  }
): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  
  const { models: modelsTable, modelSchemas } = await import('@/seedSchema')
  const { eq } = await import('drizzle-orm')
  
  // Find or create model record
  let modelRecord = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.schemaFileId, modelFileId))
    .limit(1)
  
  if (modelRecord.length === 0) {
    // Create new model record
    await db.insert(modelsTable).values({
      name: data.modelName,
      schemaFileId: modelFileId,
    })
    
    modelRecord = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, modelFileId))
      .limit(1)
  }
  
  const modelId = modelRecord[0].id
  
  // Create model_schemas join entry
  const existingJoin = await db
    .select()
    .from(modelSchemas)
    .where(
      and(
        eq(modelSchemas.modelId, modelId),
        eq(modelSchemas.schemaId, data.schemaId)
      )
    )
    .limit(1)
  
  if (existingJoin.length === 0) {
    await db.insert(modelSchemas).values({
      modelId,
      schemaId: data.schemaId,
    })
  }
  
  // Write properties if provided
  if (data.properties) {
    for (const [propName, propData] of Object.entries(data.properties)) {
      await writePropertyToDb(generateId(), {
        modelId,
        name: propName,
        ...propData,
      })
    }
  }
}

/**
 * Write property to database
 */
export async function writePropertyToDb(
  propertyFileId: string,
  data: {
    modelId: number
    name: string
    dataType: string
    // ... other property fields
  }
): Promise<void> {
  // Similar implementation for properties
}
```

### 4.2 Create ID Lookup Helpers

**File**: `src/helpers/entityIds.ts`

```typescript
/**
 * Get schema database ID from schema name or instance
 */
export async function getSchemaId(
  schemaNameOrInstance: string | Schema
): Promise<number> {
  if (typeof schemaNameOrInstance === 'string') {
    // Look up by name
    const db = BaseDb.getAppDb()
    const { schemas: schemasTable } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    
    const records = await db
      .select()
      .from(schemasTable)
      .where(eq(schemasTable.name, schemaNameOrInstance))
      .limit(1)
    
    if (records.length === 0) {
      throw new Error(`Schema "${schemaNameOrInstance}" not found in database`)
    }
    
    return records[0].id
  } else {
    // Get from instance
    const context = schemaNameOrInstance._getSnapshotContext()
    // ... get schemaId from context or DB lookup
  }
}

/**
 * Get model database ID from model name
 */
export async function getModelId(modelName: string): Promise<number> {
  // Similar implementation
}
```

---

## Phase 5: Testing & Migration

### 5.1 Detailed Cleanup Checklist

#### Schema.ts Cleanup

**Remove Methods** (lines to find and delete):
- `_registerModelInstance()` - Search for method starting around line 2337
- `_updateModelInstances()` - Search for method starting around line 2059

**Update `schemaInstanceState` WeakMap** (around line 27):
```typescript
// BEFORE:
const schemaInstanceState = new WeakMap<Schema, {
  lastContextUpdate: number
  contextUpdateTimeout: ReturnType<typeof setTimeout> | null
  lastContextHash: string | null
  cacheKeyUpdated: boolean
  lastModelsHash: string | null  // REMOVE
  modelInstancesById: Map<string, Model>  // REMOVE
  modelNameToId: Map<string, string>  // REMOVE
  modelInstances: Map<string, Model>  // REMOVE
  isClientInitialized: boolean | null
  _updateModelInstancesInProgress: boolean  // REMOVE
  _recentlyRegisteredModels: Map<string, number>  // REMOVE
  liveQuerySubscription: { unsubscribe: () => void } | null
}>()

// AFTER:
const schemaInstanceState = new WeakMap<Schema, {
  lastContextUpdate: number
  contextUpdateTimeout: ReturnType<typeof setTimeout> | null
  lastContextHash: string | null
  cacheKeyUpdated: boolean
  isClientInitialized: boolean | null
  liveQuerySubscription: { unsubscribe: () => void } | null
  liveQueryModelIds: string[]  // NEW
}>()
```

**Update Constructor** (around line 120):
- Remove initialization of removed cache Maps
- Remove `_updateModelInstancesInProgress` initialization
- Remove `_recentlyRegisteredModels` initialization
- Remove `lastModelsHash` initialization

**Update Service Subscription** (around line 143):
- Remove `lastModelsHash` comparison logic (around line 229)
- Remove `_updateModelInstances()` call (around line 259)
- Remove `_recentlyRegisteredModels` check (around line 248)
- Remove `_updateModelInstancesInProgress` check

**Update `getContext()`** (around line 309):
- Remove all references to `modelInstancesById`, `modelNameToId`, `modelInstances`
- Remove on-demand `_updateModelInstances()` call (around line 337)
- Replace with liveQuery + Model static cache lookup

**Update `unload()`** (around line 2776):
- Remove cleanup of `modelInstancesById` (around line 2781)
- Remove cleanup of `modelNameToId` (around line 2785)
- Remove cleanup of `modelInstances` (around line 2787)

**Update `_addModelsToStore()`** (around line 1859):
- Remove references to `modelNameToId` and `modelInstancesById`
- Update to use Model static cache instead

**Update `_buildModelsFromInstances()`** (around line 1005):
- Remove iteration through `modelInstancesById` (around line 1008)
- Update to use liveQuery IDs + Model static cache

#### Model.ts Cleanup

**Remove Methods** (lines to find and delete):
- `_registerPropertyInstance()` - Search for method around line 811
- `_updatePropertiesFromDb()` - Search for method around line 1280
- `_getRegisteredPropertyInstances()` - Search for method around line 835

**Update `modelInstanceState` WeakMap** (around line 18):
```typescript
// BEFORE:
const modelInstanceState = new WeakMap<Model, {
  propertyInstancesById: Map<number, any>  // REMOVE
  propertyNameToId: Map<string, number>  // REMOVE
  liveQuerySubscription: { unsubscribe: () => void } | null
}>()

// AFTER:
const modelInstanceState = new WeakMap<Model, {
  liveQuerySubscription: { unsubscribe: () => void } | null
  liveQueryPropertyIds: string[]  // NEW
}>()
```

**Update Constructor** (around line 84):
- Remove initialization of `propertyInstancesById`
- Remove initialization of `propertyNameToId`

**Update `destroy()`** (around line 1059):
- Remove cleanup of `propertyInstancesById` (around line 1061)
- Remove iteration through properties to unload (around line 1063)
- Remove cleanup of `propertyNameToId` (around line 1076)

**Update `_buildPropertiesFromInstances()`** (around line 854):
- Remove iteration through `propertyInstancesById` (around line 864)
- Update to use liveQuery IDs + ModelProperty static cache
- Or remove method entirely if properties getter builds directly

**Update LiveQuery Subscription** (around line 1255):
- Remove call to `_updatePropertiesFromDb()` (around line 1258)
- Update to just store property IDs in instanceState

**Update Properties Getter** (in Proxy around line 447):
- Remove reading from `context.properties`
- Build from ModelProperty instances using liveQuery IDs

### 5.2 Update Tests

- Remove tests for `_registerModelInstance()` and `_registerPropertyInstance()`
- Remove tests for `_updateModelInstances()` and `_updatePropertiesFromDb()`
- Add tests for write process machine
- Add tests for pending write tracking
- Add tests for liveQuery integration
- Update tests that rely on cache Maps to use static caches instead

### 5.3 Migration Strategy

1. **Backward Compatibility**: Keep old methods temporarily, mark as deprecated
2. **Gradual Migration**: Update code to use new pattern incrementally
3. **Cleanup**: Remove deprecated methods after full migration

### 5.3 Error Handling

- **Write Failures**: Revert pending writes, show error to user
- **Validation Failures**: Prevent write, show validation errors
- **Retry Logic**: Automatic retry up to 3 times for transient errors
- **Conflict Detection**: Check for conflicts before write (existing pattern)

---

## Implementation Checklist

### Phase 1: Infrastructure
- [ ] Create `writeProcessMachine.ts`
- [ ] Create `validateEntity.ts` actor
- [ ] Create `writeToDatabase.ts` actor
- [ ] Integrate write process into Model service
- [ ] Integrate write process into ModelProperty service
- [ ] Integrate write process into Schema service

### Phase 2: Schema → Models
- [ ] Remove `_registerModelInstance()` method (~360 lines)
- [ ] Remove `_updateModelInstances()` method (~270 lines)
- [ ] Remove cache Maps from `schemaInstanceState`:
  - [ ] `modelInstancesById`
  - [ ] `modelNameToId`
  - [ ] `modelInstances` (legacy)
  - [ ] `_updateModelInstancesInProgress`
  - [ ] `_recentlyRegisteredModels`
  - [ ] `lastModelsHash`
- [ ] Update `schemaInstanceState` type to only include `liveQueryModelIds`
- [ ] Remove subscription logic that calls `_updateModelInstances()`
- [ ] Update `getContext()` to use liveQuery + Model static cache
- [ ] Update `unload()` to remove cache cleanup
- [ ] Remove model data from Schema context
- [ ] Update `Model.create()` to trigger write process
- [ ] Add pending write tracking to Model class
- [ ] Update Schema liveQuery to return `modelFileId`
- [ ] Update tests

### Phase 3: Model → ModelProperties
- [ ] Remove `_registerPropertyInstance()` method
- [ ] Remove `_updatePropertiesFromDb()` method (~70 lines)
- [ ] Remove `_getRegisteredPropertyInstances()` method
- [ ] Remove cache Maps from `modelInstanceState`:
  - [ ] `propertyInstancesById`
  - [ ] `propertyNameToId`
- [ ] Update `modelInstanceState` type to only include `liveQueryPropertyIds`
- [ ] Update `destroy()` to remove property cache cleanup
- [ ] Update `_buildPropertiesFromInstances()` or remove it
- [ ] Update `ModelProperty.create()` to trigger write process
- [ ] Add pending write tracking to ModelProperty class
- [ ] Update Model liveQuery to return `propertyFileId`
- [ ] Update Model `properties` getter to use liveQuery + ModelProperty static cache
- [ ] Remove property data from Model context
- [ ] Update tests

### Phase 4: Helpers
- [ ] Create `writeModelToDb()` helper
- [ ] Create `writePropertyToDb()` helper
- [ ] Create `getSchemaId()` helper
- [ ] Create `getModelId()` helper

### Phase 5: Testing & Cleanup
- [ ] Update all tests
- [ ] Remove deprecated methods
- [ ] Update documentation
- [ ] Performance testing

---

## Code Removal Summary

### Schema Class (~710 lines removed)
- `_registerModelInstance()`: ~360 lines
- `_updateModelInstances()`: ~270 lines
- Cache management code: ~50+ lines
- Subscription logic: ~30+ lines
- **Total: ~710 lines of code removed**

### Model Class (~150 lines removed)
- `_registerPropertyInstance()`: ~25 lines
- `_updatePropertiesFromDb()`: ~70 lines
- `_getRegisteredPropertyInstances()`: ~10 lines
- Cache management code: ~45+ lines
- **Total: ~150 lines of code removed**

### Benefits

1. **Simpler Architecture**: No bidirectional registration, unidirectional flow
2. **Database as Source of Truth**: All relationships in DB, automatically synced via liveQuery
3. **Better Error Handling**: Stateful write process with validation and retry
4. **Optimistic Updates**: Instances available immediately, writes happen asynchronously
5. **Consistent Pattern**: Same pattern for Schema→Models and Model→Properties
6. **Significant Code Reduction**: ~860 lines of complex cache management code removed
7. **Single Source of Truth**: Entity instances managed by their own static caches, not parent entity caches

---

## Risks & Mitigations

### Risk: Write Failures Leave Orphaned Instances
**Mitigation**: Track pending writes, revert on failure, remove from cache

### Risk: Race Conditions with LiveQuery
**Mitigation**: Combine liveQuery results with pending writes, deduplicate IDs

### Risk: Performance Impact of Async Writes
**Mitigation**: Optimistic updates, writes happen in background, instances available immediately

### Risk: Breaking Changes
**Mitigation**: Gradual migration, keep old methods temporarily, comprehensive testing

