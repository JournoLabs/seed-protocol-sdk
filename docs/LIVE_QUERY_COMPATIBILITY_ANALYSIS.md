# LiveQuery Compatibility Analysis with Data Access Patterns

## Overview

This document analyzes the compatibility between the proposed `liveQuery` design and the existing data access patterns documented in `DATA_ACCESS_PATTERNS.md`. Specifically, we evaluate shifting from XState events to database-driven updates via `liveQuery` for cross-instance reactivity.

## Current Pattern (XState Events)

### Architecture Principle

From `DATA_ACCESS_PATTERNS.md`:
- **After Initialization**: Actor Context is the source of truth → Database (one-way writes)
- **Single Writer Pattern**: All changes flow through the actor context (XState machines)

### Current Flow: Model Name Change

```
User edits model.modelName →
  Model Proxy setter intercepts →
    Validation (automatic) →
      Update Model context (XState) →
        Save to DB (with conflict check) →
          Model sends XState event to Schema →
            Schema updates Schema.models property →
              Schema marks as draft →
                React re-renders (via XState subscriptions)
```

**Key Characteristics:**
- ✅ Synchronous: All updates happen in the same execution flow
- ✅ Guaranteed: XState events are delivered immediately
- ✅ Type-safe: Events are typed via XState
- ✅ Single-instance only: Events don't propagate across tabs/windows
- ✅ Tight coupling: Model must know about Schema instance

## Proposed Pattern (LiveQuery)

### Architecture Shift

**New Principle:**
- **After Initialization**: Actor Context is source of truth for local instance
- **For Cross-Instance Updates**: Database becomes source of truth via `liveQuery`
- **Hybrid Approach**: XState events for non-DB reactivity, `liveQuery` for DB-driven updates

### Proposed Flow: Model Name Change

```
User edits model.modelName →
  Model Proxy setter intercepts →
    Validation (automatic) →
      Update Model context (XState) →
        Save to DB (with conflict check) →
          [Transaction commits] →
            liveQuery detects DB change →
              Schema.models liveQuery subscription fires →
                Schema updates Schema.models property →
                  Schema marks as draft →
                    React re-renders (via XState subscriptions)
```

**Key Characteristics:**
- ⚠️ Asynchronous: DB change → liveQuery → Schema update (delayed)
- ✅ Cross-instance: Works across tabs/windows automatically
- ✅ Decoupled: Schema doesn't need direct reference to Model instance
- ✅ Database-driven: DB is source of truth for cross-instance state
- ⚠️ Timing dependency: Schema update happens after DB commit

## Compatibility Analysis

### ✅ Compatible Aspects

#### 1. Validation Still Happens First
- Validation occurs before DB write (unchanged)
- Conflict detection still runs before write (unchanged)
- Actor context is still updated before DB write (unchanged)

#### 2. Actor Context Remains Source of Truth (Local)
- For the local instance, actor context is still source of truth
- Reads still go through Proxy to actor context
- Only cross-instance updates shift to DB-driven

#### 3. React Reactivity Preserved
- Schema.models updates still trigger XState context updates
- React hooks still subscribe to XState services
- Re-renders still happen automatically

#### 4. Conflict Detection Still Works
- Conflict detection happens before DB write (unchanged)
- By the time liveQuery fires, the write has already succeeded
- No conflicts possible at the liveQuery stage

### ⚠️ Potential Issues

#### 1. Timing/Asynchrony

**Issue**: liveQuery updates are asynchronous, while XState events are synchronous.

**Current (XState)**:
```typescript
model.modelName = 'NewName'
// Schema.models updates immediately (synchronous)
console.log(schema.models['NewName']) // ✅ Available immediately
```

**Proposed (liveQuery)**:
```typescript
model.modelName = 'NewName'
// Schema.models updates after DB commit + liveQuery fires (asynchronous)
console.log(schema.models['NewName']) // ⚠️ May not be available yet
```

**Impact**: 
- Low for most use cases (UI updates are async anyway)
- Could cause issues if code expects immediate updates
- Need to handle loading states

**Mitigation**:
- Document that Schema.models updates are async
- Use XState events for immediate local updates (hybrid approach)
- Add loading states where needed

#### 2. Source of Truth Shift

**Issue**: Current pattern says "Actor Context is source of truth after initialization", but with liveQuery, DB becomes source of truth for cross-instance updates.

**Impact**:
- Conceptual shift in architecture
- Need to update documentation
- May confuse developers expecting immediate updates

**Mitigation**:
- Clarify: "Actor Context is source of truth for local instance"
- "Database is source of truth for cross-instance synchronization"
- Update `DATA_ACCESS_PATTERNS.md` to reflect hybrid approach

#### 3. Event Ordering

**Issue**: With XState events, order is guaranteed. With liveQuery, order depends on DB commit timing.

**Current (XState)**:
```typescript
model.modelName = 'Name1'  // Schema updates immediately
model.modelName = 'Name2'  // Schema updates immediately
// Order: Name1 → Name2 (guaranteed)
```

**Proposed (liveQuery)**:
```typescript
model.modelName = 'Name1'  // DB write queued
model.modelName = 'Name2'  // DB write queued
// Order: Depends on transaction commit order
// If both in same transaction: Only Name2 fires liveQuery
```

**Impact**:
- If multiple updates in same transaction, only final state triggers liveQuery
- This is actually correct behavior (SQLocal doesn't trigger until commit)
- Need to ensure transactions are used correctly

**Mitigation**:
- Document that liveQuery fires after transaction commit
- Multiple updates in same transaction = single liveQuery event
- This matches SQLocal's behavior (by design)

#### 4. Error Handling

**Issue**: With XState events, errors are synchronous. With liveQuery, errors are asynchronous.

**Current (XState)**:
```typescript
try {
  model.modelName = 'NewName'
  // Schema update happens here, errors thrown immediately
} catch (error) {
  // Handle error
}
```

**Proposed (liveQuery)**:
```typescript
try {
  model.modelName = 'NewName'
  // DB write happens, but Schema update is async
} catch (error) {
  // Only catches DB write errors, not liveQuery errors
}

// liveQuery errors need separate handling
schemaModels$.subscribe(
  (data) => { /* success */ },
  (error) => { /* handle liveQuery error */ }
)
```

**Impact**:
- Need separate error handling for liveQuery subscriptions
- DB write errors still caught synchronously (good)
- liveQuery errors are async (need subscription error handler)

**Mitigation**:
- Document error handling pattern
- Provide error handling utilities
- Consider wrapping liveQuery in error-handling wrapper

#### 5. Performance

**Issue**: liveQuery adds overhead (query execution on every change).

**Impact**:
- Each DB change triggers query re-execution
- Multiple liveQuery subscriptions = multiple queries
- Need to optimize queries

**Mitigation**:
- SQLocal is efficient (native SQLite change detection)
- Only queries relevant tables
- Consider query result caching if needed
- Monitor performance in production

### ✅ Benefits of LiveQuery Approach

#### 1. Cross-Instance Synchronization

**Current (XState)**: Events only work within same JavaScript context (single tab/window)

**Proposed (liveQuery)**: Works across all SQLocal instances with `reactive: true` (multiple tabs/windows)

**Use Case**: User edits Model in Tab 1, Schema in Tab 2 automatically updates

#### 2. Decoupling

**Current (XState)**: Model must have reference to Schema instance

**Proposed (liveQuery)**: Schema subscribes to DB changes, no direct Model reference needed

**Benefit**: Cleaner architecture, easier to test

#### 3. Database as Source of Truth

**Current (XState)**: Actor context is source of truth, but cross-instance sync requires manual coordination

**Proposed (liveQuery)**: Database is authoritative source for cross-instance state

**Benefit**: Consistent state across all instances

#### 4. Automatic Change Detection

**Current (XState)**: Must manually send events for each change

**Proposed (liveQuery)**: Automatically detects any DB change to queried tables

**Benefit**: Less code, fewer bugs, automatic handling of external changes

## Recommended Hybrid Approach

### When to Use XState Events

Use XState events for:
1. **Non-DB Reactivity**: Updates that don't involve database writes
2. **Immediate Local Updates**: Updates that need to be synchronous within the same instance
3. **Draft State Management**: Marking entities as draft (doesn't write to DB)
4. **Validation State**: Updating validation errors (doesn't write to DB)
5. **UI State**: Temporary UI state that doesn't persist

### When to Use LiveQuery

Use liveQuery for:
1. **Cross-Instance Updates**: Updates that need to sync across tabs/windows
2. **DB-Driven Updates**: Updates triggered by database changes
3. **Schema.models Updates**: When Model changes are written to DB
4. **Model.properties Updates**: When ModelProperty changes are written to DB
5. **External Changes**: Detecting changes made by other instances or external processes

### Hybrid Pattern Example

```typescript
// Model name change flow (hybrid)
model.modelName = 'NewName'

// 1. XState event for immediate local updates (synchronous)
model._service.send({ type: 'updateContext', modelName: 'NewName' })
// → Model context updates immediately
// → React components re-render immediately

// 2. Save to DB (with conflict check)
await model._saveDraftToDb()
// → DB write happens
// → Transaction commits

// 3. liveQuery detects DB change (asynchronous)
// → Schema.models liveQuery subscription fires
// → Schema updates Schema.models property
// → Schema marks as draft
// → React components re-render (if subscribed to Schema)

// 4. XState event for draft state (synchronous, local)
schema._service.send({ type: 'markDraft' })
// → Schema draft state updates immediately
```

## Migration Strategy

### Phase 1: Add LiveQuery Infrastructure

1. ✅ Implement `liveQuery` method in BaseDb
2. ✅ Test browser implementation
3. ✅ Document API

### Phase 2: Hybrid Implementation

1. ⏳ Keep XState events for immediate local updates
2. ⏳ Add liveQuery subscriptions for cross-instance updates
3. ⏳ Update Schema to subscribe to Model changes via liveQuery
4. ⏳ Update Model to subscribe to ModelProperty changes via liveQuery

### Phase 3: Evaluate and Optimize

1. ⏳ Monitor performance
2. ⏳ Measure timing differences
3. ⏳ Optimize queries if needed
4. ⏳ Consider removing XState events if liveQuery proves sufficient

### Phase 4: Documentation Update

1. ⏳ Update `DATA_ACCESS_PATTERNS.md` to reflect hybrid approach
2. ⏳ Document when to use XState events vs liveQuery
3. ⏳ Add migration guide for existing code

## Updated Data Flow Diagram

### Current Flow (XState Events)

```
┌─────────────┐
│   Database  │
└──────┬──────┘
       │ (Initial Load)
       ▼
┌─────────────────┐
│  Actor Context  │ ◄─── Proxy Getters (Read)
│  (XState)       │
└──────┬──────────┘
       │ (Property Set)
       ▼
┌─────────────────┐
│  Validation     │
└──────┬──────────┘
       │ (If Valid)
       ▼
┌─────────────────┐
│  Update Context │
└──────┬──────────┘
       │ (XState Reactivity)
       ▼
┌─────────────────┐
│  React Re-render│
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Save to DB     │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  XState Event   │ ────► Parent Entity Updates
│  to Parent      │
└─────────────────┘
```

### Proposed Flow (Hybrid: XState + LiveQuery)

```
┌─────────────┐
│   Database  │
└──────┬──────┘
       │ (Initial Load)
       ▼
┌─────────────────┐
│  Actor Context  │ ◄─── Proxy Getters (Read)
│  (XState)       │
└──────┬──────────┘
       │ (Property Set)
       ▼
┌─────────────────┐
│  Validation     │
└──────┬──────────┘
       │ (If Valid)
       ▼
┌─────────────────┐
│  Update Context │
└──────┬──────────┘
       │ (XState Reactivity - Immediate)
       ▼
┌─────────────────┐
│  React Re-render│ (Local instance)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Save to DB     │ (with conflict check)
└──────┬──────────┘
       │ (Transaction commits)
       ▼
┌─────────────────┐
│  LiveQuery      │ ────► Detects DB change
│  Subscription   │
└──────┬──────────┘
       │ (Asynchronous)
       ▼
┌─────────────────┐
│  Parent Entity  │ ────► Updates via liveQuery
│  Updates        │       (Cross-instance sync)
└──────┬──────────┘
       │ (XState Reactivity)
       ▼
┌─────────────────┐
│  React Re-render│ (All instances)
└─────────────────┘
```

## Conclusion

### Compatibility Assessment

**Overall**: ✅ **Compatible with modifications**

The liveQuery approach is compatible with the existing data access patterns, but requires:

1. **Hybrid Approach**: Use XState events for immediate local updates, liveQuery for cross-instance updates
2. **Documentation Updates**: Clarify that actor context is source of truth for local instance, DB for cross-instance
3. **Timing Awareness**: Document that liveQuery updates are asynchronous
4. **Error Handling**: Add error handling for liveQuery subscriptions

### Recommended Path Forward

1. **Implement liveQuery infrastructure** (Phase 1)
2. **Add hybrid implementation** for Model → Schema updates (Phase 2)
3. **Monitor and optimize** based on real-world usage (Phase 3)
4. **Update documentation** to reflect hybrid approach (Phase 4)

### Key Benefits

- ✅ Cross-instance synchronization (works across tabs/windows)
- ✅ Decoupled architecture (no direct instance references needed)
- ✅ Automatic change detection (no manual event sending)
- ✅ Database as source of truth for cross-instance state

### Key Considerations

- ⚠️ Asynchronous updates (timing differences)
- ⚠️ Error handling (separate from synchronous errors)
- ⚠️ Performance (query execution on every change)
- ⚠️ Documentation (need to clarify hybrid approach)

The hybrid approach provides the best of both worlds: immediate local updates via XState events, and reliable cross-instance synchronization via liveQuery.

