# ID-Based Caching Implementation Plan

## Overview

This plan outlines the migration from name-based caching to ID-based caching with dual indexing for Model instances. This change will simplify model name changes and provide stable identity for models.

**Additionally**, this plan includes DB-backed service persistence, where all actor/service state is stored in a `services` table, enabling state restoration on app startup and resuming/canceling long-running processes.

## Goals

1. **Primary cache keyed by ID**: Model instances are cached by `modelFileId` (never changes)
2. **Secondary index by name**: Fast O(1) lookup by name via name→ID mapping
3. **Simple name changes**: Only update name→ID mapping, no cache invalidation
4. **DB-backed service persistence**: All actor/services stored in `services` table for state restoration
5. **Cache as hot layer**: In-memory cache sits on top of DB persistence
6. **Backward compatibility**: Existing code continues to work

## Architecture Changes

### Model Class

**Current:**
```typescript
protected static instanceCache: Map<string, { instance: Model; refCount: number }>
// Key: "schemaName:modelName"
```

**New:**
```typescript
// Primary cache: ID-based (never changes on rename)
protected static instanceCacheById: Map<string, { instance: Model; refCount: number }>
// Key: modelFileId

// Secondary index: name lookup (updated on rename)
protected static instanceCacheByName: Map<string, string>
// Key: "schemaName:modelName", Value: modelFileId
```

### Schema Class

**Current:**
```typescript
modelInstances: Map<string, Model>
// Key: modelName
```

**New:**
```typescript
// Primary: ID-based (never changes on rename)
modelInstancesById: Map<string, Model>
// Key: modelFileId

// Secondary: name index (updated on rename)
modelNameToId: Map<string, string>
// Key: modelName, Value: modelFileId
```

## Implementation Steps

### Phase 1: Update Model Class Cache Structure

**File**: `src/Model/Model.ts`

#### Step 1.1: Add new cache structures
- [ ] Add `instanceCacheById: Map<string, { instance: Model; refCount: number }>`
- [ ] Add `instanceCacheByName: Map<string, string>`
- [ ] Keep `instanceCache` temporarily for backward compatibility

#### Step 1.2: Update `Model.create()` method
- [ ] Accept optional `modelFileId` parameter
- [ ] Check `instanceCacheById` first (if ID provided)
- [ ] Fall back to `instanceCacheByName` to get ID (if name provided)
- [ ] If not found, create new instance and generate ID if needed
- [ ] Store in both caches:
  - `instanceCacheById.set(modelFileId, { instance, refCount: 1 })`
  - `instanceCacheByName.set(nameKey, modelFileId)`
- [ ] Set `_modelFileId` in Model context immediately

#### Step 1.3: Add helper methods
- [ ] `static getById(modelFileId: string): Model | undefined`
- [ ] `static getByName(modelName: string, schemaName: string): Model | undefined`
- [ ] `static updateNameIndex(oldName: string, newName: string, schemaName: string): void`

#### Step 1.4: Update `unload()` method
- [ ] Get `modelFileId` from context
- [ ] Decrement ref count in `instanceCacheById`
- [ ] Remove from `instanceCacheByName` when ref count reaches 0
- [ ] Remove from `instanceCacheById` when ref count reaches 0

#### Step 1.5: Update model name change handler
- [ ] In `set()` handler for `modelName` property:
  - Get current `modelFileId` from context
  - Call `updateNameIndex(oldName, newName, schemaName)`
  - No need to update `instanceCacheById` (ID doesn't change)

#### Step 1.6: Remove old cache
- [ ] After all code paths updated, remove `instanceCache`
- [ ] Update all references to use new caches

**Testing:**
- [ ] Test Model.create() with ID
- [ ] Test Model.create() without ID (generates new)
- [ ] Test Model.getById()
- [ ] Test Model.getByName()
- [ ] Test model name changes
- [ ] Test unload() cleanup

---

### Phase 2: Update Schema Class Cache Structure

**File**: `src/schema/Schema.ts`

#### Step 2.1: Update schemaInstanceState structure
- [ ] Change `modelInstances: Map<string, Model>` to:
  - `modelInstancesById: Map<string, Model>`
  - `modelNameToId: Map<string, string>`

#### Step 2.2: Update `_updateModelInstances()` method
- [ ] When creating new Model instances:
  - Pass `modelFileId` to `Model.create(modelName, schemaName, modelFileId)`
  - Store in both indexes:
    - `modelInstancesById.set(modelFileId, modelInstance)`
    - `modelNameToId.set(modelName, modelFileId)`
- [ ] When updating existing Model instances:
  - Look up by name: `modelNameToId.get(modelName)` → get ID
  - Look up Model: `modelInstancesById.get(id)`
  - Update Model instance
- [ ] When removing models:
  - Get ID from `modelNameToId.get(modelName)`
  - Get Model from `modelInstancesById.get(id)`
  - Call `modelInstance.unload()`
  - Remove from both indexes

#### Step 2.3: Update `getContext()` in Proxy
- [ ] Convert `modelInstancesById.values()` to array
- [ ] Keep backward compatibility for name-based access if needed

#### Step 2.4: Update `_handleModelNameChange()` method
- [ ] Get `modelFileId` from `modelNameToId.get(oldName)`
- [ ] Get Model instance from `modelInstancesById.get(modelFileId)`
- [ ] Update name index:
  - `modelNameToId.delete(oldName)`
  - `modelNameToId.set(newName, modelFileId)`
- [ ] No need to update `modelInstancesById` (ID doesn't change)
- [ ] Update Model's internal name via service

#### Step 2.5: Update `unload()` method
- [ ] Iterate through `modelInstancesById.values()`
- [ ] Call `unload()` on each Model instance
- [ ] Clear both Maps

**Testing:**
- [ ] Test schema loading creates models correctly
- [ ] Test model name changes in Schema
- [ ] Test model removal from Schema
- [ ] Test `schema.models` access returns correct array
- [ ] Test schema unload() cleanup

---

### Phase 3: Update Model.create() Call Sites

**Files to update:**
1. `src/schema/Schema.ts` - `_updateModelInstances()`
2. `src/schema/service/addModelsMachine.ts` - `createModelInstances`
3. `src/imports/json.ts` - `createModelFromJson()`

#### Step 3.1: Update Schema._updateModelInstances()
- [ ] Already has `modelFileId` lookup logic
- [ ] Pass `modelFileId` to `Model.create(modelName, schemaName, modelFileId)`
- [ ] Store returned instance in both Schema indexes

#### Step 3.2: Update addModelsMachine.createModelInstances
- [ ] Already has `modelFileId` lookup logic
- [ ] Pass `modelFileId` to `Model.create(modelName, schemaName, modelFileId)`
- [ ] Store in Schema's indexes via instanceState

#### Step 3.3: Update createModelFromJson
- [ ] Look up `modelFileId` from database (if available)
- [ ] Pass `modelFileId` to `Model.create(modelName, schemaName, modelFileId)`

**Testing:**
- [ ] Test schema loading from JSON files
- [ ] Test adding models via addModelsMachine
- [ ] Test JSON import creates models correctly

---

### Phase 4: Update Model Name Change Flow

**Files to update:**
1. `src/Model/Model.ts` - name change handler
2. `src/schema/Schema.ts` - `_handleModelNameChange()`

#### Step 4.1: Update Model name change handler
- [ ] Get `modelFileId` from context
- [ ] Update `Model.instanceCacheByName`:
  - Delete old: `instanceCacheByName.delete(oldKey)`
  - Add new: `instanceCacheByName.set(newKey, modelFileId)`
- [ ] No need to update `instanceCacheById`

#### Step 4.2: Update Schema._handleModelNameChange()
- [ ] Use new dual-index structure
- [ ] Update only `modelNameToId` mapping
- [ ] No need to update `modelInstancesById`

**Testing:**
- [ ] Test model name change via Model.name setter
- [ ] Test model name change via Schema._handleModelNameChange()
- [ ] Verify caches remain consistent after rename
- [ ] Test that Model instances are still accessible after rename

---

### Phase 5: Cleanup and Optimization

#### Step 5.1: Remove backward compatibility code
- [ ] Remove old `instanceCache` from Model class
- [ ] Remove any name-based fallback logic
- [ ] Update all comments/documentation

#### Step 5.2: Add validation
- [ ] Ensure `modelFileId` is always set before Model instance is used
- [ ] Add error handling for missing IDs
- [ ] Add logging for cache operations

#### Step 5.3: Performance optimization
- [ ] Verify all lookups are O(1)
- [ ] Profile cache operations
- [ ] Optimize if needed

**Testing:**
- [ ] Full integration test suite
- [ ] Performance benchmarks
- [ ] Memory leak checks

---

## Key Implementation Details

### Model.create() Signature Change

**Before:**
```typescript
static create(modelName: string, schemaName: string): Model
```

**After:**
```typescript
static create(modelName: string, schemaName: string, modelFileId?: string): Model
```

### ID Lookup Strategy

1. **If `modelFileId` provided**: Use it directly
2. **If not provided**: 
   - Check `instanceCacheByName` for existing ID
   - If not found, look up in database
   - If still not found, generate new ID

### Name Change Flow

1. Model's `modelName` property is set to new value
2. Model updates its own `instanceCacheByName` index
3. Model notifies Schema of name change
4. Schema updates its `modelNameToId` index
5. Both `instanceCacheById` and `modelInstancesById` remain unchanged

### Cache Consistency

- **ID-based caches**: Never change on rename (stable identity)
- **Name-based indexes**: Updated on rename (O(1) operation)
- **Both indexes**: Must be kept in sync

## Testing Checklist

### Unit Tests
- [ ] Model.create() with ID
- [ ] Model.create() without ID
- [ ] Model.getById()
- [ ] Model.getByName()
- [ ] Model name changes
- [ ] Model.unload()
- [ ] Schema._updateModelInstances()
- [ ] Schema._handleModelNameChange()
- [ ] Schema.modelInstances access

### Integration Tests
- [ ] Schema loading creates models correctly
- [ ] Model name changes work end-to-end
- [ ] Model removal works correctly
- [ ] Multiple schemas with same model names
- [ ] Model instances persist across schema reloads

### Edge Cases
- [ ] Model name change when Model instance not in Schema cache
- [ ] Model name change when ID not set
- [ ] Concurrent model name changes
- [ ] Model unload during name change
- [ ] Schema unload during model operations

## Rollback Plan

If issues arise:
1. Keep old `instanceCache` alongside new caches temporarily
2. Add feature flag to switch between old/new implementation
3. Gradually migrate call sites
4. Remove old code once stable

## Success Criteria

1. ✅ All Model instances cached by ID
2. ✅ O(1) lookups by both ID and name
3. ✅ Model name changes only update name→ID mappings
4. ✅ No cache invalidation on rename
5. ✅ All existing tests pass
6. ✅ Performance equal or better than before
7. ✅ No memory leaks

## Phase 6: DB-Backed Service Persistence (NEW)

**Goal**: Store all actor/service state in database for restoration on startup

### Step 6.1: Create Services Table Schema

**File**: `src/seedSchema/ServiceSchema.ts` (new file)

- [ ] Create `services` table schema:
  ```typescript
  export const services = sqliteTable('services', {
    id: text('id').primaryKey(), // modelFileId, schemaFileId, etc.
    type: text('type').notNull(), // 'model', 'schema', 'modelProperty'
    snapshot: text('snapshot').notNull(), // JSON stringified XState snapshot
    state: text('state'), // 'idle', 'loading', 'validating', etc.
    createdAt: int('created_at'),
    updatedAt: int('updated_at'),
  })
  ```
- [ ] Add migration file
- [ ] Export types

### Step 6.2: Service Persistence Helpers

**File**: `src/helpers/servicePersistence.ts` (new file)

- [ ] `saveServiceToDb(id: string, type: string, service: ActorRef): Promise<void>`
  - Serialize service snapshot using `service.getPersistedSnapshot()`
  - Store in `services` table
  - Update `updatedAt` timestamp
  
- [ ] `loadServiceFromDb(id: string, type: string): Promise<Snapshot | null>`
  - Query `services` table by ID and type
  - Deserialize snapshot JSON
  - Return snapshot for `createActor(..., { snapshot })`
  
- [ ] `deleteServiceFromDb(id: string, type: string): Promise<void>`
  - Remove service from DB when unloaded

### Step 6.3: Update Model.create() to Check DB First

**File**: `src/Model/Model.ts`

- [ ] Before creating new Model instance:
  - Check in-memory cache first (fast path)
  - If not in cache, check DB for existing service state
  - If found in DB:
    - Deserialize snapshot
    - Restore actor: `createActor(modelMachine, { snapshot })`
    - Store in cache
    - Return restored instance
  - If not found:
    - Create new instance normally
    - Save to DB after initialization

**Flow:**
```typescript
static async create(modelName: string, schemaName: string, modelFileId?: string): Promise<Model> {
  // 1. Check in-memory cache
  if (modelFileId && this.instanceCacheById.has(modelFileId)) {
    return this.instanceCacheById.get(modelFileId)!.instance
  }
  
  // 2. Check DB for persisted service
  if (modelFileId) {
    const snapshot = await loadServiceFromDb(modelFileId, 'model')
    if (snapshot) {
      // Restore from DB
      const service = createActor(modelMachine, { snapshot })
      const modelInstance = new Model(/* ... */)
      modelInstance._service = service
      // Store in cache
      this.instanceCacheById.set(modelFileId, { instance: modelInstance, refCount: 1 })
      return modelInstance
    }
  }
  
  // 3. Create new instance
  const newInstance = new Model(modelName, schemaName)
  // ... initialize ...
  
  // 4. Save to DB after initialization
  newInstance._service.subscribe((snapshot) => {
    if (snapshot.value === 'idle') {
      saveServiceToDb(modelFileId, 'model', newInstance._service)
    }
  })
  
  return newInstance
}
```

### Step 6.4: Update Schema.create() to Check DB First

**File**: `src/schema/Schema.ts`

- [ ] Similar pattern: check cache → check DB → create new
- [ ] Restore Schema service from DB if found
- [ ] Save Schema service to DB on state changes

### Step 6.5: Auto-Save Service State

- [ ] Subscribe to service state changes
- [ ] Debounce saves (don't save on every snapshot)
- [ ] Save on:
  - State transitions (idle, loading, error)
  - Context updates (debounced)
  - Before unload

### Step 6.6: App Startup Service Restoration

**File**: `src/client/ClientManager.ts` or new startup file

- [ ] On app startup:
  - Query all services from DB
  - Group by type (model, schema, modelProperty)
  - Restore each service:
    - Deserialize snapshot
    - Create actor with snapshot
    - Create wrapper instance (Model, Schema, etc.)
    - Store in cache
  - Resume any long-running processes

**Flow:**
```typescript
async restoreServicesFromDb(): Promise<void> {
  const db = BaseDb.getAppDb()
  const allServices = await db.select().from(services)
  
  for (const serviceRecord of allServices) {
    const snapshot = JSON.parse(serviceRecord.snapshot)
    
    switch (serviceRecord.type) {
      case 'model':
        const modelInstance = await Model.restoreFromSnapshot(snapshot)
        // Store in cache
        break
      case 'schema':
        const schemaInstance = await Schema.restoreFromSnapshot(snapshot)
        break
      // ...
    }
  }
}
```

### Step 6.7: Handle Stale Services

- [ ] Detect stale services (e.g., schema file changed)
- [ ] Option to:
  - Discard stale service and create fresh
  - Merge DB state with fresh schema data
  - Prompt user for action

**Testing:**
- [ ] Test service save/restore cycle
- [ ] Test app startup restoration
- [ ] Test stale service detection
- [ ] Test concurrent access (multiple instances)
- [ ] Test service cleanup on unload

---

## Impact of DB Persistence on ID-Based Caching

### Benefits

1. **ID becomes even more critical**: DB lookups by ID are faster than by name
2. **Cache as hot layer**: In-memory cache sits on top of DB (two-tier caching)
3. **State persistence**: Long-running processes can resume after app restart
4. **Consistency**: DB is source of truth, cache is performance optimization

### Changes to Existing Phases

**Phase 1 (Model Class)**:
- `Model.create()` becomes async (needs DB lookup)
- Add `Model.restoreFromSnapshot()` static method
- Add service subscription for auto-save

**Phase 2 (Schema Class)**:
- `Schema.create()` may need async DB check
- Add `Schema.restoreFromSnapshot()` static method
- Coordinate Model restoration with Schema restoration

**Phase 3 (Call Sites)**:
- Update all `Model.create()` calls to `await Model.create()`
- Handle async initialization

**Phase 4 (Name Changes)**:
- Update DB service record when name changes
- Update service snapshot with new name

**Phase 5 (Cleanup)**:
- Remove service from DB on unload
- Clean up stale services

### New Considerations

1. **Async initialization**: Model/Schema creation may need to be async
2. **Service lifecycle**: Need to coordinate cache and DB state
3. **Snapshot serialization**: Ensure all context is serializable
4. **Performance**: DB lookups add latency, but cache mitigates
5. **Conflict resolution**: Handle DB vs cache inconsistencies

## Timeline Estimate

- **Phase 1**: 2-3 days (Model class changes)
- **Phase 2**: 2-3 days (Schema class changes)
- **Phase 3**: 1 day (Call site updates)
- **Phase 4**: 1 day (Name change flow)
- **Phase 5**: 1-2 days (Cleanup and testing)
- **Phase 6**: 3-4 days (DB persistence layer)

**Total**: ~10-14 days

## Notes

- This is a breaking change internally but maintains API compatibility
- All Model instances must have IDs before use
- Consider adding migration helper for existing Model instances without IDs
- Document the new caching strategy for future developers
- **DB Persistence**: Services table becomes source of truth, cache is performance layer
- **Async Considerations**: Model.create() and Schema.create() may need to be async
- **State Restoration**: Long-running processes can resume after app restart
- **Cache Invalidation**: DB changes should invalidate cache (or cache should check DB version)

