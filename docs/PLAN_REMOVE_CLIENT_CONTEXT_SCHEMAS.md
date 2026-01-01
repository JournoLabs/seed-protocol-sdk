# Plan: Remove `_updateClientContext` and Client Schema Instance Assumptions

## Overview
This plan outlines the removal of `_updateClientContext` from the Schema class and all code that assumes the client context will hold schema instances. The system has moved to using static retrieval methods (`Schema.getById()`, `Schema.createById()`) and database queries (`loadAllSchemasFromDb()`) as the source of truth.

## Current State Analysis

### 1. `_updateClientContext` Method
**Location:** `src/schema/Schema.ts` (lines 1661-1785)

**Purpose:** Updates client context with current schema state to keep `useSchema` and `useSchemas` hooks in sync.

**Called from:**
- Schema constructor subscription (line 224) - when schema becomes idle
- `sendUpdate` handler for `name` property (lines 343, 460)
- `sendUpdate` handler for `createdAt`/`updatedAt` properties (line 617)
- `sendUpdate` handler for other tracked properties (line 643)

**Dependencies:**
- ClientManager (`getClient()`)
- ClientManagerEvents (`UPDATE_CONTEXT`)
- ClientManagerState (`IDLE`)
- Client context structure (`context.schemas`)

### 2. Client Context Schema Storage
**Current Usage:**
- `loadOrCreateSchema.ts` (lines 124-178): Checks client context FIRST before database lookup
- `useSchemas` hook (lines 245-280): Reads schema names from client context
- `processSchemaFiles.ts` (line 107): Populates client context with schemas
- `importJsonSchema` (lines 444-477): Updates client context after import
- `useCreateSchema` (lines 514-580): Updates client context after schema creation

### 3. Schema Constructor Subscription
**Location:** `src/schema/Schema.ts` (lines 111-231)

**Purpose:** Subscribes to schema service changes and calls `_updateClientContext()` when schema is idle.

**Complexity:**
- Client initialization checks with caching (lines 116-162)
- Context hash comparison to prevent unnecessary updates (lines 168-203)
- Debouncing logic (lines 208-229)

## Removal Plan

### Phase 1: Remove `_updateClientContext` Method and All Calls

#### Step 1.1: Remove `_updateClientContext` method
- **File:** `src/schema/Schema.ts`
- **Lines to remove:** 1655-1785 (entire method)
- **Also remove:**
  - Debug logger: `const contextLogger = debug('seedSdk:schema:updateClientContext')` (line 16)
  - Client initialization cache variables (lines 29-32) if only used for context updates

#### Step 1.2: Remove calls from Schema constructor subscription
- **File:** `src/schema/Schema.ts`
- **Lines to modify:** 111-231
- **Action:** Remove the entire subscription block that calls `_updateClientContext()`
- **Alternative:** If subscription is needed for other purposes, keep it but remove context update logic

#### Step 1.3: Remove calls from property update handlers
- **File:** `src/schema/Schema.ts`
- **Locations:**
  - Line 224: In constructor subscription timeout
  - Line 343: In `name` property update (sendUpdate handler)
  - Line 460: In `name` property update (after name change)
  - Line 617: In `createdAt`/`updatedAt` property update
  - Line 643: In other tracked property updates
- **Action:** Remove all `_updateClientContext()` calls and related comments

### Phase 2: Update `loadOrCreateSchema` to Remove Client Context Dependency

#### Step 2.1: Remove client context check
- **File:** `src/Schema/service/actors/loadOrCreateSchema.ts`
- **Lines to remove:** 124-178 (STEP 0: Check client context)
- **Action:** Remove the entire try-catch block that checks `clientSnapshot.context.schemas`
- **Rationale:** Database is now the source of truth; no need to check client context first

### Phase 3: Update React Hooks to Use Static/Database Methods

#### Step 3.1: Update `useSchemas` hook
- **File:** `src/browser/react/schema.ts`
- **Current approach:** Reads schema names from client context (lines 245-280)
- **New approach:** Use `loadAllSchemasFromDb()` or `Schema.all()` / `Schema.latest()` static methods
- **Changes needed:**
  - Replace `useSelector` that reads from `context.schemas` with a database query
  - Use `useEffect` to fetch schemas from database instead of subscribing to client context
  - Consider using `useAllSchemaVersions` pattern as reference (lines 385-458)

#### Step 3.2: Verify `useSchema` hook
- **File:** `src/browser/react/schema.ts`
- **Status:** Already uses `Schema.getById()` and `Schema.createById()` (lines 133-158)
- **Action:** Verify it doesn't depend on client context for schema retrieval (it doesn't appear to)

### Phase 4: Remove Client Context Updates from Other Files

#### Step 4.1: Update `processSchemaFiles`
- **File:** `src/client/actors/processSchemaFiles.ts`
- **Current:** Populates `context.schemas` (line 107, 147)
- **Decision needed:** 
  - Option A: Remove schema population entirely (schemas loaded on-demand via static methods)
  - Option B: Keep for backward compatibility but mark as deprecated
  - **Recommendation:** Option A - remove entirely since hooks will query database directly

#### Step 4.2: Update `importJsonSchema`
- **File:** `src/imports/json.ts`
- **Lines to remove:** 444-477 (client context update after import)
- **Action:** Remove the entire try-catch block that updates client context
- **Rationale:** Schema is saved to database; hooks will pick it up via database queries

#### Step 4.3: Update `useCreateSchema`
- **File:** `src/browser/react/schema.ts`
- **Lines to modify:** 514-580 (client context update in subscription)
- **Action:** Remove client context update logic
- **Alternative:** If needed, trigger a refetch of schemas from database instead

### Phase 5: Clean Up Client Initialization Checks

#### Step 5.1: Remove client initialization cache
- **File:** `src/schema/Schema.ts`
- **Lines to review:** 29-32, 116-162, 1244-1286
- **Action:** 
  - Check if `cachedClientInitialized` and `clientCheckTime` are only used for context updates
  - If yes, remove them entirely
  - If used elsewhere (e.g., `_saveDraftToDb`), keep but remove context update checks

#### Step 5.2: Review `_saveDraftToDb` client checks
- **File:** `src/schema/Schema.ts`
- **Lines:** 1244-1286
- **Action:** Verify if client initialization checks are still needed for draft saving
- **Note:** These checks might be legitimate for preventing saves during initialization, not just for context updates

### Phase 6: Update Tests

#### Step 6.1: Update tests that check client context
- **Files:**
  - `__tests__/browser/react/schema.test.tsx`
  - `__tests__/browser/react/model.test.tsx`
  - `__tests__/client/actors/processSchemaFiles.test.ts`
- **Action:** 
  - Remove assertions that check `snapshot.context.schemas`
  - Update to verify schemas are retrieved via static methods or database queries
  - Update mocks if needed

## Migration Strategy

### Order of Operations
1. **Phase 1** - Remove `_updateClientContext` and all calls (cleanest removal)
2. **Phase 3** - Update React hooks to use database queries (ensures hooks still work)
3. **Phase 2** - Remove client context check from `loadOrCreateSchema` (now safe since hooks don't depend on it)
4. **Phase 4** - Remove client context updates from other files (cleanup)
5. **Phase 5** - Clean up initialization checks (final cleanup)
6. **Phase 6** - Update tests (validation)

### Backward Compatibility Considerations
- **Breaking Changes:** None expected
  - `useSchema` already uses static methods
  - `useSchemas` will switch from client context to database queries (same data source)
  - Schema instances are still cached via `Schema.instanceCacheById` and `Schema.instanceCacheByName`

### Risk Assessment
- **Low Risk:**
  - Removing `_updateClientContext` calls (they're fire-and-forget)
  - Updating `useSchemas` to use database queries (more reliable)
  
- **Medium Risk:**
  - Removing client context check from `loadOrCreateSchema` (ensure database queries work correctly)
  - Removing schema population from `processSchemaFiles` (verify no other code depends on it)

- **Testing Required:**
  - Verify `useSchemas` still works correctly
  - Verify schema loading in `loadOrCreateSchema` works without client context
  - Verify schema creation/import still works
  - Verify cross-tab synchronization (if applicable)

## Implementation Notes

### Alternative Approaches Considered
1. **Keep client context as cache only:** Rejected - adds complexity without benefit
2. **Gradual deprecation:** Rejected - clean break is better given the new architecture
3. **Hybrid approach:** Rejected - database is source of truth, no need for client context

### Performance Considerations
- Database queries are already optimized via static caches
- `loadAllSchemasFromDb()` is efficient and used elsewhere
- React hooks can use `useMemo`/`useCallback` to optimize database queries

### Future Enhancements
- Consider adding a `useSchemasQuery` hook that uses React Query or similar for better caching
- Consider adding schema change notifications via database subscriptions (if needed)
- Consider optimizing `loadAllSchemasFromDb()` with pagination if schema count grows large

## Files to Modify

### Core Schema Files
1. `src/schema/Schema.ts` - Remove `_updateClientContext` and all calls
2. `src/Schema/service/actors/loadOrCreateSchema.ts` - Remove client context check

### React Hooks
3. `src/browser/react/schema.ts` - Update `useSchemas` to use database queries

### Client/Import Files
4. `src/client/actors/processSchemaFiles.ts` - Remove schema population (or mark deprecated)
5. `src/imports/json.ts` - Remove client context update

### Test Files
6. `__tests__/browser/react/schema.test.tsx`
7. `__tests__/browser/react/model.test.tsx`
8. `__tests__/client/actors/processSchemaFiles.test.ts`

## Success Criteria
- [ ] `_updateClientContext` method removed
- [ ] All calls to `_updateClientContext` removed
- [ ] `loadOrCreateSchema` no longer checks client context
- [ ] `useSchemas` uses database queries instead of client context
- [ ] All tests pass
- [ ] No references to `context.schemas` for schema retrieval (only for other purposes if needed)
- [ ] Schema instances still work correctly via static methods
- [ ] React hooks still function correctly

