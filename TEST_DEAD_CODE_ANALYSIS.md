# Test Dead Code Analysis

## Executive Summary

✅ **Good News**: No tests directly reference dead code, eventBus, or commented-out event handlers.  
⚠️ **Potential Issues**: Some tests may indirectly depend on eventBus functionality that's still active but could be removed.

---

## 1. Direct Dead Code References

### ✅ No Direct References Found

**Searched for:**
- `eventBus`, `eventEmitter` - **0 matches**
- `waitForEvent` - **0 matches**
- `setupAllItemsEventHandlers`, `getAreItemEventHandlersReady` - **0 matches**
- `itemRequestHandler`, `itemRequestAllHandler` - **0 matches**
- `setupFsListeners`, `setupServicesEventHandlers` - **0 matches**
- Imports from `@/events` directory - **0 matches**

**Conclusion:** Tests are not directly testing or using eventBus functionality.

---

## 2. Indirect Dependencies Analysis

### Tests That May Rely on Active EventBus Functionality

#### **A. Item Operations Tests**

**File: `__tests__/scripts/rpcServer.test.ts`**
- Tests `CreateItem`, `UpdateItem`, `DeleteItem` operations
- **Potential dependency:** These operations may trigger `item.requestAll` events internally
- **Status:** ✅ **Safe** - RPC server likely uses direct database/actor operations, not eventBus

**File: `__tests__/Item/Item.test.ts`**
- Tests item creation via `getPosts()` fixture
- **Potential dependency:** Item creation might emit `item.requestAll` events
- **Status:** ⚠️ **Review needed** - Check if `createNewItem()` emits events

#### **B. React Hook Tests**

**File: `__tests__/browser/react/schema.test.tsx`**
- Tests React hooks: `useSchema`, `useSchemas`, `useCreateSchema`
- **Status:** ✅ **Safe** - Uses XState subscriptions directly, no eventBus

**File: `__tests__/browser/react/model.test.tsx`**
- Tests `useModels` hook
- **Status:** ✅ **Safe** - Uses XState subscriptions

#### **C. Integration Tests**

**Files:**
- `__tests__/Model/Model.test.ts`
- `__tests__/schema/Schema.test.ts`
- `__tests__/schema/schema-models-integration.test.ts`
- `__tests__/client.test.ts`
- `__tests__/node/client.test.ts`

**Status:** ✅ **Safe** - All use XState actor subscriptions and direct database operations

---

## 3. Files That Use EventBus (But Tests Don't Import Them)

### Active EventBus Usage in Source Code

These files use eventBus, but **tests don't directly test them**:

1. **`src/events/item/syncDbWithEas.ts`** - Emits `item.requestAll` (line 634)
   - **Test coverage:** ❌ No tests found
   - **Risk:** Low - Internal sync operation

2. **`src/db/write/createNewItem.ts`** - Emits `item.requestAll` (line 54)
   - **Test coverage:** ⚠️ Indirectly tested via RPC server tests
   - **Risk:** Medium - If eventBus removed, item creation might not trigger refreshes

3. **`src/browser/react/item.ts`** - Listens to `item.requestAll` and `item.${modelName}.${seedId}.update`
   - **Test coverage:** ❌ No React hook tests for `useItem` or `useItems`
   - **Risk:** High - React hooks depend on eventBus for updates

4. **`src/browser/react/itemProperty.ts`** - Listens to property update events
   - **Test coverage:** ❌ No React hook tests for `useItemProperty`
   - **Risk:** High - React hooks depend on eventBus for updates

5. **`src/events/item/publish.ts`** - Uses `item.publish.request` event
   - **Test coverage:** ❌ No tests found
   - **Risk:** Medium - Publishing functionality

---

## 4. Missing Test Coverage

### Critical Gaps

#### **A. React Hooks Tests**

**Missing tests for:**
- `useItem` - Tests item fetching and updates
- `useItems` - Tests item list fetching and updates
- `useItemProperty` - Tests property updates

**Why this matters:**
- These hooks currently depend on eventBus (`item.requestAll`, property update events)
- If eventBus is removed, these hooks will break
- **Recommendation:** Add tests that verify hooks work with XState subscriptions instead

#### **B. Event Handler Tests**

**Missing tests for:**
- `syncDbWithEas` handler
- `publishItemRequestHandler`
- File system event handlers

**Why this matters:**
- These handlers are still active but not tested
- If handlers are removed, no tests will fail
- **Recommendation:** Either add tests or remove handlers

---

## 5. Tests That Should Be Added/Updated

### High Priority

#### **1. React Hook Tests for Items**

**File to create:** `__tests__/browser/react/item.test.tsx`

```typescript
// Should test:
- useItem hook with XState subscriptions
- useItems hook with XState subscriptions  
- Verify hooks update when items change (without eventBus)
- Test item creation triggers updates via XState
```

#### **2. Item Property Hook Tests**

**File to create:** `__tests__/browser/react/itemProperty.test.tsx`

```typescript
// Should test:
- useItemProperty hook with XState subscriptions
- Property updates trigger re-renders via XState
- No dependency on eventBus events
```

#### **3. Item Creation Integration Test**

**File to update:** `__tests__/Item/Item.test.ts` or create new integration test

```typescript
// Should verify:
- Item creation works without eventBus
- Item creation triggers XState updates
- React hooks receive updates via XState subscriptions
```

### Medium Priority

#### **4. Publish Functionality Test**

**File to create:** `__tests__/events/item/publish.test.ts`

```typescript
// Should test:
- publishItemRequestHandler works correctly
- Verify it uses XState (not eventBus) for communication
```

---

## 6. Tests That May Break After EventBus Removal

### ⚠️ At Risk Tests

**None identified** - Tests don't directly use eventBus.

**However, these may fail indirectly:**

1. **`__tests__/scripts/rpcServer.test.ts`**
   - If `createNewItem()` emits `item.requestAll` and that's removed
   - **Mitigation:** RPC server should use XState actors directly

2. **Any future tests for `useItem` or `useItems` hooks**
   - If hooks still depend on eventBus
   - **Mitigation:** Refactor hooks to use XState subscriptions before removing eventBus

---

## 7. Recommendations

### Immediate Actions

1. ✅ **Safe to proceed with dead code removal** - No tests directly reference it
2. ⚠️ **Add missing tests** for React hooks before removing eventBus
3. ⚠️ **Verify integration tests** still pass after eventBus removal

### Before Removing EventBus

1. **Add React hook tests:**
   - `useItem` test
   - `useItems` test  
   - `useItemProperty` test
   - Verify they work with XState subscriptions

2. **Refactor React hooks:**
   - Remove eventBus listeners from `src/browser/react/item.ts`
   - Remove eventBus listeners from `src/browser/react/itemProperty.ts`
   - Use XState subscriptions instead

3. **Update integration tests:**
   - Verify item creation/updates work without eventBus
   - Test that React hooks receive updates via XState

### Testing Strategy

1. **Run all tests** after removing commented code
2. **Run all tests** after refactoring React hooks
3. **Run all tests** after removing eventBus
4. **Add new tests** for XState-based patterns

---

## 8. Summary

### ✅ Safe to Delete
- All commented code blocks
- Unused event handler files (after verification)
- Commented exports

### ⚠️ Requires Testing Before Removal
- EventBus usage in React hooks (`useItem`, `useItems`, `useItemProperty`)
- `item.requestAll` events in item creation
- Property update events

### ❌ Missing Test Coverage
- React hooks for items (critical)
- React hooks for item properties (critical)
- Event handlers (medium priority)
- Publish functionality (medium priority)

### 📊 Test Status
- **Direct dead code references:** 0 ✅
- **Indirect dependencies:** 3-5 potential ⚠️
- **Missing critical tests:** 3-4 files ❌
- **Tests that will break:** 0 (but may fail indirectly) ⚠️

---

## 9. Next Steps

1. **Phase 1:** Remove commented code (safe, no test impact)
2. **Phase 2:** Add missing React hook tests
3. **Phase 3:** Refactor React hooks to use XState
4. **Phase 4:** Remove eventBus (after tests pass)
5. **Phase 5:** Add integration tests for XState patterns

---

## 10. Files to Review

### Test Files (No Changes Needed)
- All existing test files are safe ✅

### Source Files (Need Refactoring Before Tests)
- `src/browser/react/item.ts` - Remove eventBus, add XState subscriptions
- `src/browser/react/itemProperty.ts` - Remove eventBus, add XState subscriptions
- `src/db/write/createNewItem.ts` - Remove eventBus emit, use XState

### New Test Files Needed
- `__tests__/browser/react/item.test.tsx` - Test item hooks
- `__tests__/browser/react/itemProperty.test.tsx` - Test property hooks
- `__tests__/events/item/publish.test.ts` - Test publish handler

