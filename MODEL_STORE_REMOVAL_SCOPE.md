# Scope of Work: Remove Model Store and ModelClass Concept

## Overview
This document outlines the scope of work to eliminate the model store (`src/stores/modelClass.ts`) and the `ModelClass` concept, migrating all code to use the `Model` class directly with static accessors like `Model.create()`, `Model.getById()`, and `Model.getByName()`.

## Current State

### Model Store (`src/stores/modelClass.ts`)
- Global Map storing `ModelClassType` instances by model name
- Functions: `getModel()`, `setModel()`, `getModels()`, `getModelNames()`
- Uses global symbol for cross-module sharing

### ModelClass (`src/Model/ModelClass.ts`)
- Wrapper class providing backward compatibility
- Static interface: `schema`, `create()`, `modelName`, `schemaName`
- Wraps a `Model` instance internally

### Model Class Static Methods (Already Available)
- `Model.create()` - Create or get cached Model instance
- `Model.getById(modelFileId)` - Get Model by file ID
- `Model.getByName(modelName, schemaName)` - Get Model by name
- `Model.createById(modelFileId)` - Create or get Model by ID (with DB lookup)
- `Model.createBySchemaId(schemaId)` - Get all models for a schema

## Migration Strategy

### Phase 1: Replace Model Store Access Patterns

#### 1.1 Replace `getModel(modelName)` calls
**Files to update:**
- `src/Item/BaseItem.ts` (4 occurrences)
- `src/ItemProperty/BaseItemProperty.ts` (1 occurrence)
- `src/helpers/property/index.ts` (multiple occurrences)
- `src/ModelProperty/ModelProperty.ts` (1 occurrence)
- `src/events/item/requestAll.ts` (1 occurrence)
- `src/db/write/createNewItem.ts` (1 occurrence)
- `src/node/codegen/drizzle.ts` (1 occurrence)
- `scripts/rpcServer.ts` (1 occurrence)

**Migration pattern:**
```typescript
// Before
const ModelClass = getModel(modelName)
const schema = ModelClass?.schema

// After
const model = Model.getByName(modelName, schemaName) // Need schemaName context
const schema = model?.schema
```

**Challenge:** Many `getModel()` calls don't have `schemaName` context. Need to:
- Pass `schemaName` through function parameters where missing
- Use `Model.getById()` if `modelFileId` is available
- Query database to find model if only `modelName` is known

#### 1.2 Replace `getModels()` calls
**Files to update:**
- `src/events/item/syncDbWithEas.ts` (2 occurrences)
- `src/db/read/getModelSchemas.ts` (1 occurrence)
- `src/eas.ts` (1 occurrence)

**Migration pattern:**
```typescript
// Before
const models = getModels()
for (const [modelName, ModelClass] of Object.entries(models)) {
  const schema = ModelClass.schema
}

// After
// Need to get all models - may require:
// 1. New static method: Model.getAll() or Model.getAllBySchema(schemaName)
// 2. Or query database directly
// 3. Or maintain a registry in Model class (static Set/Map)
```

**Action:** Add `Model.getAll()` or `Model.getAllBySchema(schemaName)` static method

#### 1.3 Remove `setModel()` calls
**Files to update:**
- `src/Model/Model.ts` (1 occurrence - in `Model.create()`)
- `src/client/actors/platformClassesInit.ts` (1 occurrence)
- `src/client/actors/addModelsToStore.ts` (1 occurrence)
- `src/Schema/service/addModelsMachine.ts` (1 occurrence)
- `src/imports/json.ts` (2 occurrences)
- `src/helpers/updateSchema.ts` (1 occurrence)

**Migration pattern:**
```typescript
// Before
setModel(modelName, WrappedModelClass)

// After
// Remove - Model.create() already handles instance caching
// No registration needed
```

#### 1.4 Replace `getModelNames()` calls
**Files to update:**
- `src/events/item/syncDbWithEas.ts` (1 occurrence)

**Migration pattern:**
```typescript
// Before
for (const modelName of getModelNames()) { }

// After
// Use Model.getAll() or query database
const allModels = await Model.getAll() // If we add this method
// Or: const modelNames = await db.select().from(modelsTable).map(r => r.name)
```

### Phase 2: Update Type Definitions

#### 2.1 Replace `ModelClassType` with `Model`
**Files to update:**
- `src/types/model.ts` - Update `ModelClassType` definition
- `src/types/machines.ts` - Update context types
- `src/types/item.ts` - Update `ItemData` type
- `src/types/index.ts` - Update exports
- `src/index.ts` - Update exports

**Migration pattern:**
```typescript
// Before
export type ModelClassType = {
  originalConstructor: () => void
  schema: ModelSchema
  schemaUid?: string
  create: (values: ModelValues<any>) => Promise<BaseItem<any>>
}

// After
// Replace with Model class or create a type alias:
export type ModelInstance = Model
// Or use Model directly in type definitions
```

**Files using ModelClassType:**
- `src/types/model.ts` (definition)
- `src/types/machines.ts` (2 occurrences)
- `src/types/item.ts` (1 occurrence)
- `src/types/index.ts` (1 occurrence)
- `src/index.ts` (1 occurrence - export)
- `src/client/actors/platformClassesInit.ts` (1 occurrence)
- `src/node/codegen/drizzle.ts` (1 occurrence)
- `src/helpers/schema.ts` (1 occurrence)
- `src/ItemProperty/service/actors/fetchDataFromEas.ts` (1 occurrence)
- `packages/cli/src/init.ts` (1 occurrence)
- Test files (multiple)

#### 2.2 Update `ModelDefinitions` type
**File:** `src/types/model.ts`

```typescript
// Before
export type ModelDefinitions = {
  [modelName: string]: ModelClassType
}

// After
export type ModelDefinitions = {
  [modelName: string]: Model
}
```

### Phase 3: Update Event Handlers and Contexts

#### 3.1 Update Item Machine Context
**Files to update:**
- `src/Item/service/actors/initialize.ts` - Remove `ModelClass` from context
- `src/Item/service/actors/hydrateExistingItem.ts` - Remove `ModelClass` from context
- `src/types/item.ts` - Update `ItemMachineContext` type

**Migration pattern:**
```typescript
// Before
const { ModelClass, modelName } = context
const modelName = ModelClass?.originalConstructor?.name || modelName

// After
const { modelName, schemaName } = context
const model = Model.getByName(modelName, schemaName)
// Or use modelName directly if it's already in context
```

#### 3.2 Update Event Handlers
**Files to update:**
- `src/events/item/create.ts` - Remove `ModelClass` from event
- `src/events/item/syncDbWithEas.ts` - Update model access

**Migration pattern:**
```typescript
// Before
export const createItemRequestHandler = async (event) => {
  const { ModelClass, itemData } = event
  const modelName = ModelClass?.originalConstructor?.name
}

// After
export const createItemRequestHandler = async (event) => {
  const { modelName, schemaName, itemData } = event
  // modelName is already available, no need for ModelClass
}
```

### Phase 4: Update Client Initialization

#### 4.1 Update `platformClassesInit`
**File:** `src/client/actors/platformClassesInit.ts`

**Migration pattern:**
```typescript
// Before
if (models) {
  for (const [key, value] of Object.entries(models)) {
    setModel(key, value as ModelClassType)
  }
}

// After
// Remove - models should already be Model instances
// If models are passed in config, they should be Model instances
// No registration needed
```

**Note:** Need to verify how models are passed in `SeedConstructorOptions`. If they're ModelClassType instances, they need to be converted to Model instances or the API needs to change.

#### 4.2 Update `addModelsToStore`
**File:** `src/client/actors/addModelsToStore.ts`

**Migration pattern:**
```typescript
// Before
setModel(key, value as unknown as ModelClassType)

// After
// Remove - models are already Model instances, no registration needed
```

### Phase 5: Update Import/Export Functions

#### 5.1 Update JSON Import
**File:** `src/imports/json.ts`

**Current code creates ModelClass wrapper:**
```typescript
// Lines 740-806: Creates WrappedModelClass
// Lines 821-823: Registers in modelDefinitions and setModel
```

**Migration:**
- Remove ModelClass wrapper creation
- Return Model instance directly
- Remove `setModel()` call
- Update return type from `ModelClassType` to `Model`

#### 5.2 Update Markdown Import
**File:** `src/imports/markdown.ts`

**Current code creates mock ModelClass:**
```typescript
// Line 131: Creates mock ModelClass structure
```

**Migration:**
- Return Model instance instead of mock ModelClass
- Update to use `Model.create()`

### Phase 6: Update Model.create() Implementation

#### 6.1 Remove ModelClass Wrapper Creation
**File:** `src/Model/Model.ts` (lines 551-582)

**Current code:**
```typescript
// Step 7.5: Create ModelClass wrapper and register in model store
const WrappedModelClass = class { ... }
setModel(modelName, WrappedModelClass as any)
```

**Migration:**
- Remove WrappedModelClass creation
- Remove `setModel()` call
- Remove import of `setModel` from `@/stores/modelClass`

### Phase 7: Update Helper Functions

#### 7.1 Update Property Helpers
**File:** `src/helpers/property/index.ts`

**Multiple `getModel()` calls need schemaName context:**
- Line 48: `getModel(modelName)` - needs schemaName
- Line 122: `getModel(modelName)` - needs schemaName
- Line 171: `getModel(modelName)` - needs schemaName
- Line 209: `getModel(modelName)` - needs schemaName

**Migration:**
- Add `schemaName` parameter to functions that need it
- Use `Model.getByName(modelName, schemaName)`

#### 7.2 Update Schema Helpers
**File:** `src/helpers/updateSchema.ts`

**Migration:**
- Remove `setModel()` call (line 502)
- Models should already be Model instances

#### 7.3 Update DB Helpers
**File:** `src/db/write/createNewItem.ts`

**Migration:**
```typescript
// Before
const propertySchemas = getModel(modelName)?.schema

// After
// Need schemaName - may need to query or pass as parameter
const model = Model.getByName(modelName, schemaName)
const propertySchemas = model?.schema
```

### Phase 8: Update Node-Specific Code

#### 8.1 Update Node Exports
**File:** `src/node/index.ts`

**Current exports:**
```typescript
export { getModels, getModel, getModelNames } from '../stores/modelClass'
```

**Migration:**
- Remove these exports
- Or create wrapper functions that use Model static methods:
```typescript
export const getModel = (modelName: string, schemaName: string) => {
  return Model.getByName(modelName, schemaName)
}
// But this requires schemaName, which may not be available
```

#### 8.2 Update Codegen
**File:** `src/node/codegen/drizzle.ts`

**Migration:**
```typescript
// Before
generateDrizzleSchemaCode(modelName, modelClass: ModelClassType)

// After
generateDrizzleSchemaCode(modelName, model: Model)
// Update function signature to accept Model instead of ModelClassType
```

### Phase 9: Add Missing Model Static Methods

#### 9.1 Add `Model.getAll()` or `Model.getAllBySchema()`
**Purpose:** Replace `getModels()` functionality

**Implementation options:**
1. **Static registry in Model class:**
   ```typescript
   protected static allInstances: Set<Model> = new Set()
   // Register in Model.create()
   static getAll(): Model[] {
     return Array.from(this.allInstances)
   }
   ```

2. **Query database:**
   ```typescript
   static async getAllBySchema(schemaName: string): Promise<Model[]> {
     // Query database for all models in schema
     // Create Model instances for each
   }
   ```

3. **Hybrid approach:** Maintain static registry + database fallback

**Recommendation:** Use static registry for performance, with database query as fallback.

#### 9.2 Add `Model.getByName()` overload for single parameter
**Current:** `Model.getByName(modelName, schemaName)` requires both parameters

**Challenge:** Many places only have `modelName`, not `schemaName`

**Options:**
1. Query database to find model by name (slower)
2. Require schemaName everywhere (breaking change)
3. Add overload: `Model.getByName(modelName)` that queries DB

**Recommendation:** Add overload that queries database if schemaName not provided.

### Phase 10: Remove Files and Clean Up

#### 10.1 Delete Files
- `src/stores/modelClass.ts` - Entire file
- `src/Model/ModelClass.ts` - Entire file

#### 10.2 Remove Exports
- `src/index.ts` - Remove `getModels, getModel, getModelNames` exports
- `src/index.ts` - Remove `ModelClassType as ModelClass` export (or update to Model)
- `src/node/index.ts` - Remove model store exports

#### 10.3 Update Imports
- Remove all imports of `@/stores/modelClass`
- Remove all imports of `@/Model/ModelClass`

### Phase 11: Update Tests

#### 11.1 Update Test Mocks
**Files:**
- `__tests__/client.test.ts`
- `__tests__/client/actors/processSchemaFiles.test.ts`
- `__tests__/schema/property.test.ts`

**Migration:**
- Replace `ModelClassType` mocks with `Model` instances
- Use `Model.create()` to create test models

#### 11.2 Update Test Assertions
- Update all tests that check for `ModelClass` or `ModelClassType`
- Update tests that use `getModel()`, `setModel()`, etc.

### Phase 12: Update Documentation

#### 12.1 Update Type Documentation
- Document that `ModelClassType` is deprecated/removed
- Document new `Model` static accessor patterns

#### 12.2 Update API Documentation
- Update examples to use `Model.create()`, `Model.getById()`, etc.
- Remove references to model store

## Implementation Order

### Recommended Sequence:
1. **Phase 9** - Add missing Model static methods first (enables migration)
2. **Phase 2** - Update type definitions (establishes new contract)
3. **Phase 1** - Replace model store access patterns (core migration)
4. **Phase 3** - Update event handlers (depends on Phase 1)
5. **Phase 4** - Update client initialization (depends on Phase 1)
6. **Phase 5** - Update import/export functions (depends on Phase 1)
7. **Phase 6** - Update Model.create() (remove wrapper creation)
8. **Phase 7** - Update helper functions (depends on Phase 1)
9. **Phase 8** - Update node-specific code (depends on Phase 1)
10. **Phase 10** - Remove files and clean up (final step)
11. **Phase 11** - Update tests (ongoing, but finalize after all changes)
12. **Phase 12** - Update documentation (final step)

## Key Challenges

### Challenge 1: Missing `schemaName` Context
**Problem:** Many `getModel(modelName)` calls don't have `schemaName` available.

**Solutions:**
1. Pass `schemaName` through function parameters (preferred)
2. Query database to find model by name (fallback)
3. Add `Model.getByName(modelName)` overload that queries DB

### Challenge 2: Getting All Models
**Problem:** `getModels()` returns all models, but `Model` class doesn't have equivalent.

**Solution:** Add `Model.getAll()` static method with registry.

### Challenge 3: Client Initialization
**Problem:** `SeedConstructorOptions.models` may be `ModelClassType` instances.

**Solution:** 
- Update API to accept `Model` instances
- Or convert `ModelClassType` to `Model` during initialization
- Or remove models from config (they should be created via `Model.create()`)

### Challenge 4: Type Compatibility
**Problem:** `ModelClassType` is used in many type definitions.

**Solution:**
- Replace with `Model` class
- Or create type alias: `type ModelInstance = Model`
- Update all type definitions gradually

### Challenge 5: Backward Compatibility
**Problem:** External code may depend on `getModel()`, `ModelClassType`, etc.

**Solution:**
- This is a breaking change
- Document migration path
- Consider deprecation period with warnings

## Testing Strategy

### Unit Tests
- Test `Model.getAll()` method
- Test `Model.getByName()` with and without schemaName
- Test that `Model.create()` no longer calls `setModel()`
- Test all replaced `getModel()` calls

### Integration Tests
- Test item creation without model store
- Test model import/export without model store
- Test client initialization without model store
- Test event handlers without ModelClass

### Regression Tests
- Ensure all existing functionality still works
- Test model caching still works
- Test model instance reuse

## Success Criteria

1. ✅ `src/stores/modelClass.ts` is deleted
2. ✅ `src/Model/ModelClass.ts` is deleted
3. ✅ No imports of model store or ModelClass
4. ✅ All `getModel()` calls replaced with `Model.getByName()` or `Model.getById()`
5. ✅ All `setModel()` calls removed
6. ✅ All `getModels()` calls replaced with `Model.getAll()` or equivalent
7. ✅ All `ModelClassType` references replaced with `Model`
8. ✅ All tests pass
9. ✅ No runtime errors related to missing model store
10. ✅ Documentation updated

## Estimated Effort

- **Phase 1:** 8-12 hours (many files, need schemaName context)
- **Phase 2:** 2-3 hours (type updates)
- **Phase 3:** 3-4 hours (event handlers)
- **Phase 4:** 2-3 hours (client init)
- **Phase 5:** 4-6 hours (import/export)
- **Phase 6:** 1 hour (Model.create cleanup)
- **Phase 7:** 4-6 hours (helpers)
- **Phase 8:** 2-3 hours (node code)
- **Phase 9:** 3-4 hours (new static methods)
- **Phase 10:** 1 hour (cleanup)
- **Phase 11:** 6-8 hours (tests)
- **Phase 12:** 2-3 hours (docs)

**Total:** ~38-56 hours

## Notes

- This is a significant refactoring that touches many files
- Consider doing this in a feature branch with thorough testing
- May want to add deprecation warnings first, then remove in next major version
- Consider keeping `getModel()` as a deprecated wrapper function that uses `Model.getByName()` internally for backward compatibility during transition period

