# LiveQuery Issues Analysis

## Overview

This document analyzes the two failing tests related to `useItemProperties` hook and `useLiveQuery` integration. The tests are failing because properties are not loading in specific scenarios, even though the data exists in the database.

## Failing Tests

1. **Test: "should automatically update when properties change (liveQuery integration)"** (line 853)
   - Creates an item with properties
   - Waits for properties to be in database (verified with direct query)
   - Renders component with `useItemProperties`
   - Expects properties to load, but they don't appear

2. **Test: "should display properties list and show updates when properties change"** (line 932)
   - Creates a new schema, model, and item dynamically
   - Waits for properties to be in database
   - Renders component with `useItemProperties`
   - Expects properties to load, but they don't appear

## Root Cause Analysis

### Issue 1: Initial Query Execution Timing

**Problem**: `useLiveQuery` returns `undefined` initially and only sets data when the observable emits. However, SQLocal's `reactiveQuery` may not emit immediately upon subscription, or there may be a delay between when data is written to the database and when the reactive query detects it.

**Evidence**:
- In `useLiveQuery` (line 36): `const [data, setData] = useState<T[] | undefined>(undefined)`
- The observable is created in `useMemo` and subscribed in `useEffect`
- SQLocal's `reactiveQuery` should execute immediately, but there's no guarantee of synchronous emission

**Impact**: 
- `propertiesTableData` stays `undefined` initially
- `fetchItemProperties` won't run (line 402-404 checks for `undefined`)
- Component waits indefinitely for data that exists but hasn't been emitted yet

### Issue 2: Race Condition with Database Writes

**Problem**: The tests verify data exists using direct database queries, but `reactiveQuery` might not have detected the changes yet, especially if:
- The data was written in a transaction that hasn't fully committed
- There's a delay between write and reactive query detection
- The reactive query executes before the transaction commits

**Evidence**:
- Tests wait for data using direct queries (lines 872-882, 998-1008)
- Then immediately render the component
- But `reactiveQuery` might not have detected the changes yet

**Impact**:
- Data exists in database (verified by test)
- But `reactiveQuery` hasn't emitted it yet
- Component renders with `undefined` data
- Test times out waiting for properties

### Issue 3: Drizzle Query Builder Execution

**Problem**: When passing a Drizzle query builder to SQLocal's `reactiveQuery`, SQLocal needs to execute the query. There may be an issue with:
- How Drizzle queries are serialized/executed in the reactive context
- Whether the query is executed immediately or lazily
- Whether the query execution happens synchronously or asynchronously

**Evidence**:
- `useItemProperties` creates a Drizzle query builder (lines 308-352)
- Passes it to `useLiveQuery` (line 354)
- `useLiveQuery` passes it to `BaseDb.liveQuery` (line 49)
- `BaseDb.liveQuery` passes it to SQLocal's `reactiveQuery` (line 561)

**Impact**:
- Query might not execute immediately
- Or query executes but doesn't emit results synchronously
- Results in `undefined` data initially

### Issue 4: Empty Array vs Undefined Distinction

**Problem**: The code treats `undefined` (query not executed) differently from `[]` (query executed, no results). However:
- If query executes and returns empty array initially (before data is detected), properties are set to empty
- The code doesn't distinguish between "no data exists" and "data exists but not detected yet"

**Evidence**:
- Line 402-404: Returns early if `propertiesTableData === undefined`
- Line 412-417: Sets properties to empty array if `propertiesTableData.length === 0`
- No retry mechanism if query returns empty but data exists

**Impact**:
- If query executes before data is fully committed, returns empty array
- Properties set to empty, no retry
- Even when data arrives later, might not trigger update if change detection doesn't work

## Technical Details

### useLiveQuery Implementation

```typescript
// src/browser/react/liveQuery.ts
export function useLiveQuery<T>(
  query: ((sql: any) => any) | any | null | undefined
): T[] | undefined {
  const [data, setData] = useState<T[] | undefined>(undefined)
  // ...
  const observable = useMemo(() => {
    if (!isClientReady || !query) {
      return null
    }
    return BaseDb.liveQuery<T>(query)
  }, [query, isClientReady])
  
  useEffect(() => {
    // Subscribe to observable
    const subscription = observable.subscribe({
      next: (results) => {
        setData(results)
      },
      // ...
    })
  }, [observable])
  
  return data  // Returns undefined initially
}
```

**Key Points**:
- Returns `undefined` until observable emits
- Observable created in `useMemo`, subscribed in `useEffect`
- No initial synchronous execution

### SQLocal reactiveQuery Behavior

Based on SQLocal documentation:
- `reactiveQuery` should execute the query immediately when subscribed
- Then re-execute when underlying tables change
- Works with Drizzle query builders directly

**Potential Issues**:
- Execution might be asynchronous
- Might not emit immediately if data was just written
- Transaction timing might affect when changes are detected

### useItemProperties Flow

```typescript
// 1. Create query
const propertiesQuery = useMemo(() => { /* Drizzle query */ }, [...])

// 2. Use liveQuery
const rawPropertiesTableData = useLiveQuery(propertiesQuery)  // undefined initially

// 3. Filter data
const propertiesTableData = useMemo(() => {
  if (!rawPropertiesTableData || rawPropertiesTableData.length === 0) {
    return []
  }
  // Filter for latest records
}, [rawPropertiesTableData])

// 4. Fetch properties
useEffect(() => {
  if (propertiesTableData === undefined) {
    return  // Won't fetch if undefined
  }
  fetchItemProperties()
}, [propertiesTableData, fetchItemProperties])
```

**Key Points**:
- Waits for `propertiesTableData !== undefined` before fetching
- If `rawPropertiesTableData` is `undefined`, `propertiesTableData` is also `undefined`
- No fetch happens until data is emitted

## Recommendations

### 1. Add Initial Query Execution

**Option A**: Execute query synchronously on first render to get initial data:
- Check if observable supports immediate execution
- Or execute query directly before subscribing

**Option B**: Use a separate initial query execution:
- Execute query once directly to get initial data
- Then subscribe to reactive query for updates

### 2. Handle Empty vs Undefined Better

- Distinguish between "not loaded yet" (`undefined`) and "loaded but empty" (`[]`)
- Add retry logic or longer wait times
- Consider polling as fallback if reactive query doesn't emit

### 3. Add Debugging/Logging

- Log when `reactiveQuery` subscribes
- Log when it emits data
- Log query execution timing
- Compare with direct database queries

### 4. Verify SQLocal Behavior

- Test if `reactiveQuery` with Drizzle queries executes immediately
- Test if it emits synchronously or asynchronously
- Test transaction timing and change detection

### 5. Consider Fallback Mechanism

- If `useLiveQuery` returns `undefined` for too long, execute direct query
- Or add a timeout that triggers a direct query
- Or use polling as fallback

## Test Scenarios to Investigate

1. **Timing Test**: Measure time between:
   - Data written to database
   - Direct query returns data
   - Reactive query emits data
   - Component receives data

2. **Transaction Test**: Test if reactive query detects changes:
   - Within same transaction
   - After transaction commits
   - With different transaction timing

3. **Query Execution Test**: Test if Drizzle query builder:
   - Executes immediately when passed to `reactiveQuery`
   - Emits synchronously or asynchronously
   - Works correctly with SQLocal's reactive system

## Critical Finding: SQLocal reactiveQuery Initial Emission

**Key Issue**: SQLocal's `reactiveQuery` may not emit immediately upon subscription, especially with Drizzle query builders.

**Evidence**:
- Documentation states it "should execute immediately", but this may be:
  - Asynchronous execution
  - Delayed emission
  - Query execution happens but emission is deferred

**Impact**:
- Component subscribes to observable
- Observable doesn't emit immediately
- `useLiveQuery` returns `undefined`
- `useItemProperties` waits for data that never arrives (or arrives too late)

**Potential Root Cause**:
When SQLocal's `reactiveQuery` receives a Drizzle query builder:
1. It needs to serialize/execute the query
2. This might happen asynchronously
3. The subscription might not receive initial data immediately
4. Or the query might execute but not emit until a change is detected

## Conclusion - UPDATED WITH TEST RESULTS

### Root Cause Identified ✅

After running comprehensive timing tests, we discovered the **actual root cause**:

**Reactive queries emit immediately for initial data, but they DO NOT detect updates/changes to existing data.**

### Test Results Summary

1. ✅ **Initial Emission**: Reactive queries emit immediately (1.6-2.9ms) when data exists
2. ✅ **Drizzle Query Builders**: Work correctly with reactiveQuery
3. ❌ **Update Detection**: Reactive queries do NOT emit when data is updated (CRITICAL ISSUE)

### The Real Problem

The failing tests follow this pattern:
1. Data exists in database (verified by direct queries) ✅
2. Component renders and reactive query emits initial data ✅
3. **But when new properties are created or existing properties are updated, the reactive query does NOT emit again** ❌
4. Component never sees the new/updated data
5. Test times out waiting for properties that exist but aren't detected

### Evidence from Tests

**Scenario 3 Results**:
- Initial emission: ✅ 2 records (works)
- After property update: ❌ No emission (should have emitted again)
- Total emissions: 1 (should be 2)
- **WARNING: Reactive query did not detect update!**

### Why This Happens

SQLocal's `reactiveQuery` appears to:
- ✅ Detect initial data and emit immediately
- ❌ NOT detect UPDATE operations on existing records
- ❌ NOT detect when new records are added after initial subscription

This could be:
1. SQLocal limitation: Only detects INSERT, not UPDATE
2. Transaction timing: Updates don't trigger reactive detection
3. Table watching: Reactive query not properly tracking metadata table changes
4. Drizzle integration: Issue with how Drizzle queries track table changes

### The Solution

**Immediate Fix Options**:
1. **Polling Fallback**: Add polling mechanism when reactive query doesn't detect updates
2. **Manual Refresh**: Trigger direct query refresh when properties change
3. **Event-Based Updates**: Use event system to notify hooks when properties are updated
4. **Hybrid Approach**: Use reactive query for initial load, direct queries for updates

**Long-term Solutions**:
1. Investigate if SQLocal reactiveQuery supports UPDATE detection
2. Consider using SQL tag functions instead of Drizzle builders
3. Implement custom change detection mechanism
4. Use event system for property change notifications
