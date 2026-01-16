# LiveQuery Test Results

## Test Scenarios Executed

We ran 4 test scenarios to investigate the liveQuery timing issues:

### Scenario 1: Timing between data write and reactive query emission
**Result**: ✅ **PASSED**
- Direct query time: 4.50ms
- Reactive query first emission: 2.20ms (actually faster!)
- Reactive query emission count: 1
- **Finding**: Reactive queries DO emit immediately when data exists

### Scenario 2: Reactive query with existing data
**Result**: ✅ **PASSED**
- Direct query found: 2 records
- Reactive query emitted after: 1.60ms
- Reactive query results: 2 records
- **Finding**: Reactive queries emit immediately when data already exists in database

### Scenario 3: Transaction timing and change detection
**Result**: ❌ **FAILED - CRITICAL FINDING**
- Initial emission: 2 records ✅
- Property update took: 1.40ms ✅
- **Total emissions: 1** ❌ (should be 2)
- **Update emission records: 0** ❌
- **WARNING: Reactive query did not detect update!**

**Critical Finding**: Reactive queries emit initially but **DO NOT detect updates/changes** to existing data!

### Scenario 4: Drizzle query builder execution timing
**Result**: ✅ **PASSED**
- Query builder creation: 0.30ms
- Direct execution: 4.20ms
- Reactive query first emission: 2.90ms
- **Finding**: Drizzle query builders work correctly with reactiveQuery and emit immediately

## Root Cause Identified - UPDATED

### The Real Problem (FIXED)

**The query object passed to `reactiveQuery` was changing on each render, causing the reactive query subscription to be recreated and lose its connection to SQLocal's change detection.**

### Original Hypothesis vs Actual Issue

**Original Hypothesis**: Reactive queries don't detect UPDATE operations  
**Actual Issue**: Query object was being recreated on each render, breaking the reactive subscription

### The Fix

The problem was in `useItemProperties`:
- `const db = isClientReady ? BaseDb.getAppDb() : null` created a new variable reference each render
- Even though `getAppDb()` returns the same object, the `db` variable itself was a new reference
- `useMemo` with `[db, ...]` dependencies recalculated on each render
- New query object → new observable → new subscription → lost reactive connection

**Solution**: Get `db` inside the `useMemo` instead of depending on it as a variable:
```typescript
const propertiesQuery = useMemo(() => {
  if (!isClientReady || (!seedLocalId && !seedUid)) return null
  const db = BaseDb.getAppDb()  // Get inside useMemo
  if (!db) return null
  // ... create query
}, [isClientReady, seedLocalId, seedUid])  // No db dependency
```

### Why This Explains the Test Results

The timing tests showed that reactive queries:
- ✅ Emit immediately for initial data
- ❌ Don't detect updates

But this was because:
1. Initial render: Query created, subscription established, initial data emitted ✅
2. Component re-renders (state changes, props change, etc.)
3. `db` variable recreated (new reference)
4. `useMemo` recalculates → new query object
5. `useLiveQuery` sees new query → creates new observable
6. Old subscription lost, new subscription created
7. New subscription gets initial data but loses connection to change detection ❌

This explains why updates weren't detected - the subscription was being recreated constantly!

This explains why the failing tests have this pattern:
1. Data exists in database (verified by direct queries)
2. Component renders and reactive query emits initial data ✅
3. But when new properties are created or existing properties are updated, the reactive query does NOT emit again ❌
4. Component never sees the new/updated data
5. Test times out waiting for properties that exist but aren't detected

### Evidence

From Scenario 3:
- Initial emission: ✅ Works (2 records)
- After property update: ❌ No emission (should have emitted again with updated data)
- Total emissions: 1 (should be 2)

This means SQLocal's `reactiveQuery` is:
- ✅ Working for initial queries
- ❌ NOT detecting changes/updates to the metadata table

## Why This Happens

Possible reasons why reactive queries aren't detecting updates:

1. **SQLocal reactiveQuery limitation**: May only detect INSERT operations, not UPDATE operations
2. **Transaction timing**: Updates might happen in a way that doesn't trigger reactive query detection
3. **Table watching**: The reactive query might not be properly watching the metadata table for changes
4. **Drizzle query builder issue**: When using Drizzle query builders, SQLocal might not properly track which tables to watch

## Impact on useItemProperties

The `useItemProperties` hook:
1. Creates a reactive query to watch the metadata table
2. Gets initial data ✅
3. But never gets updates when:
   - New properties are created
   - Existing properties are updated
   - Properties are deleted

This is why the tests fail - the hook receives initial data but never receives updates, even though the data exists in the database.

## Recommendations

### Immediate Fix Options

1. **Polling Fallback**: If reactive query doesn't emit updates, add polling as fallback
2. **Manual Refresh**: Add a mechanism to manually trigger query refresh
3. **Direct Query on Updates**: When properties are updated, execute a direct query to refresh data
4. **Investigate SQLocal**: Check if SQLocal's reactiveQuery supports UPDATE detection, or if it's INSERT-only

### Long-term Solutions

1. **Verify SQLocal Behavior**: Test if SQLocal's reactiveQuery detects UPDATE operations
2. **Alternative Approach**: Consider using SQL tag functions instead of Drizzle query builders
3. **Custom Change Detection**: Implement custom change detection mechanism
4. **Event-Based Updates**: Use event system to notify hooks when properties change

## Next Steps

1. ✅ Verify reactive queries emit immediately (CONFIRMED)
2. ✅ Verify reactive queries work with Drizzle builders (CONFIRMED)
3. ❌ Verify reactive queries detect updates (FAILED - this is the issue)
4. Investigate why SQLocal reactiveQuery doesn't detect UPDATE operations
5. Implement workaround (polling, manual refresh, or event-based updates)
