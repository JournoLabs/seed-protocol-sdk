# Test Refactoring Requirements After Model Edit Flow Changes

## Overview

After refactoring the Model-Schema relationship to eliminate circular updates, several integration tests need to be reviewed and potentially updated. The core architectural change is:

**Schema never sends update events to Model instances. Model instances are independent entities that load from the database.**

## Key Architectural Changes

1. **Model → Schema**: Model edits no longer notify Schema during edits (only during persistence)
2. **Schema → Model**: Schema never updates Model instances (only references them)
3. **Model Loading**: Model instances load from database first, not from Schema context
4. **Schema Persistence**: Schema reads from Model instances when saving, not from `context.models`

## Test Files Requiring Review

### 1. `__tests__/Schema/schema-models-integration.test.ts`

**Status**: ⚠️ **NEEDS REVIEW**

**Current Tests:**
- `should load schema with models from internal schema file`
- `should load schema with models from database schemaData`
- `should populate models even when schemaData is missing`
- `should update modelInstances when context.models changes`

**Potential Issues:**

1. **Test: `should update modelInstances when context.models changes` (line 308)**
   - **Current Behavior**: Tests that `modelInstances` are updated when `context.models` changes
   - **New Behavior**: `_updateModelInstances` no longer updates existing Model instances, only references them
   - **Action Required**: 
     - Update test to verify that Model instances are **referenced** (not updated) when `context.models` changes
     - Verify that existing Model instances maintain their own state
     - Test should check that Schema's cache contains Model instances, but not that they were updated

2. **All Tests Checking `context.models`:**
   - **Current Behavior**: Tests verify `context.models` is populated
   - **New Behavior**: `context.models` is still populated from file/database load, but Model instances are independent
   - **Action Required**: 
     - Tests should still verify `context.models` exists (this is correct - it's loaded from file/db)
     - Tests should verify `schema.models` returns Model instances (this should still work)
     - **No changes needed** - these tests should still pass

**Recommended Changes:**
- Update test description for "should update modelInstances when context.models changes" to "should reference modelInstances when context.models changes"
- Verify that Model instances are not updated when Schema context changes
- Add test to verify Model instances maintain their own state independently

---

### 2. `__tests__/Schema/Schema.test.ts`

**Status**: ⚠️ **NEEDS REVIEW**

**Current Tests:**
- `should include newly created Model in Schema.models property` (line 906)
- `should update models array` (line 773)

**Potential Issues:**

1. **Test: `should include newly created Model in Schema.models property` (line 906)**
   - **Current Behavior**: Creates Model, waits for registration, checks `schema.models` includes it
   - **New Behavior**: Model registration still adds Model instance to Schema's cache
   - **Action Required**: 
     - Test should still pass, but timing might be different
     - Verify that Model instance is added to Schema's cache via `_registerModelInstance`
     - **No changes needed** - this test should still work

2. **Test: `should update models array` (line 773)**
   - **Current Behavior**: Tests that `schema.models` array can be updated directly
   - **New Behavior**: `schema.models` is read-only (returns Model instances from cache)
   - **Action Required**: 
     - **CRITICAL**: This test likely needs to be removed or significantly changed
     - `schema.models` should not be directly assignable - it's a computed property from Model instances
     - Test should verify that Model instances in Schema's cache are returned, not that the array can be modified
     - Check if this test is testing a valid use case or if it's testing an anti-pattern

**Recommended Changes:**
- Review `should update models array` test - likely needs removal or rewrite
- Verify that `schema.models` is read-only (computed from Model instances)
- Add test to verify Model instances are independent (editing Model doesn't immediately update Schema context)

---

### 3. `__tests__/Model/Model.test.ts`

**Status**: ⚠️ **NEEDS REVIEW**

**Current Tests:**
- `should register model with schema when created with schema instance` (line 992)
- `should not register model with schema when registerWithSchema is false` (line 1017)
- `should update model name` (line 677)
- `should update model properties` (line 698)
- `should update model indexes` (line 725)

**Potential Issues:**

1. **Test: `should register model with schema when created with schema instance` (line 992)**
   - **Current Behavior**: Checks that `schemaContext.models['TestModel']` is defined after registration
   - **New Behavior**: Model registration still updates Schema's `context.models` (via `_registerModelInstance`)
   - **Action Required**: 
     - Test should still pass
     - **No changes needed** - registration still updates Schema context

2. **Tests: `should update model name/properties/indexes` (lines 677, 698, 725)**
   - **Current Behavior**: Tests that Model properties can be updated
   - **New Behavior**: Model properties can still be updated, but they no longer notify Schema during edits
   - **Action Required**: 
     - Tests should still pass - Model edits still work
     - **Consider adding**: Test to verify Schema's `context.models` is NOT updated immediately when Model is edited
     - **Consider adding**: Test to verify Schema reads from Model instances when persisting

**Recommended Changes:**
- Add test: "Model edits should not update Schema context immediately"
- Add test: "Model edits should be reflected when Schema persists"
- Verify existing tests still pass (they should)

---

### 4. `__tests__/browser/react/model.test.tsx`

**Status**: ⚠️ **NEEDS REVIEW**

**Current Tests:**
- Tests React hooks `useModel` and `useModels`
- Tests that `schema.models` returns Model instances

**Potential Issues:**

1. **Tests Accessing `schema.models`:**
   - **Current Behavior**: Tests verify `schema.models` returns Model instances
   - **New Behavior**: `schema.models` still returns Model instances (from Schema's cache)
   - **Action Required**: 
     - Tests should still pass
     - **No changes needed** - `schema.models` behavior is unchanged

2. **Tests Checking Model Registration:**
   - **Current Behavior**: Tests verify Model appears in `schema.models` after creation
   - **New Behavior**: Model registration still adds to Schema's cache
   - **Action Required**: 
     - Tests should still pass
     - **No changes needed**

**Recommended Changes:**
- Verify all tests still pass
- Consider adding test for Model edit independence (editing Model doesn't trigger Schema updates)

---

### 5. `__tests__/browser/react/schema.test.tsx`

**Status**: ⚠️ **NEEDS REVIEW**

**Current Tests:**
- `should display empty models list initially and show new model after creation` (line 622)
- Tests React hooks `useSchema`, `useSchemas`

**Potential Issues:**

1. **Test: `should display empty models list initially and show new model after creation` (line 622)**
   - **Current Behavior**: Creates Model, waits for `_updateModelInstances` to complete
   - **New Behavior**: `_updateModelInstances` no longer updates Model instances, only references them
   - **Action Required**: 
     - Test comment mentions "wait for _updateModelInstances to complete, which updates the schema's context" (line 692)
     - **Update comment**: `_updateModelInstances` now only references Model instances, doesn't update them
     - Test should still pass, but the comment is misleading
     - Verify timing is still correct

2. **Tests Checking `schema.models`:**
   - **Current Behavior**: Tests verify `schema.models` returns Model instances
   - **New Behavior**: `schema.models` still returns Model instances
   - **Action Required**: 
     - Tests should still pass
     - **No changes needed**

**Recommended Changes:**
- Update comment on line 692 to reflect new behavior
- Verify test timing is still correct
- Consider adding test for Model edit independence

---

## Tests That Should Be Added

### 1. Model Edit Independence Tests

**Location**: `__tests__/Model/Model.test.ts`

**New Tests Needed:**

1. **"Model edits should not update Schema context immediately"**
   ```typescript
   it('should not update Schema context when Model is edited', async () => {
     // Create schema and model
     // Edit model properties
     // Verify Schema context.models is NOT updated immediately
     // Verify Model instance has the new values
   })
   ```

2. **"Schema should read from Model instances when persisting"**
   ```typescript
   it('should read from Model instances when saving schema', async () => {
     // Create schema and model
     // Edit model properties
     // Save schema
     // Verify saved schema contains Model instance data (not context.models)
   })
   ```

3. **"Model instances should load from database, not Schema context"**
   ```typescript
   it('should load Model data from database first', async () => {
     // Create model and save to database
     // Create new Model instance with same ID
     // Verify Model loads from database, not Schema context
   })
   ```

### 2. Schema Read-Only Relationship Tests

**Location**: `__tests__/Schema/Schema.test.ts`

**New Tests Needed:**

1. **"Schema should not update Model instances when context changes"**
   ```typescript
   it('should not update Model instances when Schema context changes', async () => {
     // Create schema and model
     // Manually update Schema context.models
     // Verify Model instance is NOT updated
     // Verify Model instance maintains its own state
   })
   ```

2. **"Schema.models should be read-only (computed from Model instances)"**
   ```typescript
   it('should return Model instances from cache (read-only)', async () => {
     // Create schema and model
     // Try to modify schema.models array
     // Verify it doesn't affect Model instances
     // Verify schema.models returns Model instances from cache
   })
   ```

---

## Tests That Should Be Removed or Significantly Changed

### 1. `__tests__/Schema/Schema.test.ts` - "should update models array" (line 773)

**Reason**: This test appears to test that `schema.models` can be directly assigned, which is an anti-pattern. `schema.models` should be read-only (computed from Model instances).

**Action**: 
- **Remove** if it's testing direct assignment
- **Rewrite** if it's testing a valid use case (e.g., adding Model instances to Schema's cache)

---

## Summary of Required Actions

### High Priority (Tests That May Fail)

1. ✅ **Review** `__tests__/Schema/Schema.test.ts` - "should update models array" test
2. ✅ **Update** `__tests__/browser/react/schema.test.tsx` - Comment on line 692
3. ✅ **Review** `__tests__/Schema/schema-models-integration.test.ts` - "should update modelInstances when context.models changes" test

### Medium Priority (Tests That Should Still Pass But Need Verification)

1. ✅ **Verify** all tests in `__tests__/Model/Model.test.ts` still pass
2. ✅ **Verify** all tests in `__tests__/browser/react/model.test.tsx` still pass
3. ✅ **Verify** all tests in `__tests__/Schema/schema-models-integration.test.ts` still pass

### Low Priority (New Tests to Add)

1. ✅ **Add** Model edit independence tests
2. ✅ **Add** Schema read-only relationship tests
3. ✅ **Add** Model loading from database tests

---

## Testing Strategy

### Phase 1: Run Existing Tests
1. Run all integration tests to identify failures
2. Document which tests fail and why
3. Prioritize fixes based on test importance

### Phase 2: Fix Failing Tests
1. Update test expectations to match new behavior
2. Remove or rewrite tests that test anti-patterns
3. Update comments and documentation

### Phase 3: Add New Tests
1. Add tests for Model edit independence
2. Add tests for Schema read-only relationship
3. Add tests for Model loading from database

### Phase 4: Verify All Tests Pass
1. Run full test suite
2. Verify no regressions
3. Update test documentation

---

## Key Test Assertions to Verify

### ✅ Should Still Work (No Changes Needed)

- `schema.models` returns array of Model instances
- `context.models` is populated from file/database load
- Model instances can be created and registered with Schema
- Model properties can be edited
- React hooks work with Model and Schema instances

### ⚠️ May Need Updates

- Tests checking that Model edits immediately update Schema context
- Tests checking that Schema context changes update Model instances
- Tests checking that `schema.models` array can be directly modified
- Tests with timing assumptions about Model→Schema updates

### ❌ Should Be Removed or Changed

- Tests that directly assign to `schema.models` array
- Tests that verify Schema updates Model instances when context changes
- Tests that verify Model edits immediately update Schema context

---

## Notes

1. **Timing Changes**: Some tests may need longer timeouts if they rely on Model→Schema update notifications (which no longer happen during edits)

2. **Database State**: Tests should ensure database is properly set up, as Model instances now load from database first

3. **Cache Behavior**: Tests should verify that Model instances are cached correctly and that Schema references them (not updates them)

4. **Persistence**: Tests should verify that Schema reads from Model instances when saving, not from `context.models`

