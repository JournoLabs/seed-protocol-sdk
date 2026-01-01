# Live Query Design Document

## Overview

This document outlines the design for adding reactive query capabilities to the Seed Protocol SDK's database layer. The `liveQuery` method will enable real-time detection of Model, Schema, and ModelProperty updates at the database level by subscribing to SQL/Drizzle queries.

## Objectives

1. **Add `liveQuery<T>` method** to `BaseDb` class for reactive database queries
2. **Browser Implementation**: Leverage SQLocal's `reactiveQuery` feature for native database-level reactivity
3. **Node Implementation**: Stub out with RxJS-based polling mechanism (to be enhanced later)
4. **Enable reactive updates** for Model, Schema, and ModelProperty instances

## Architecture

### Class Hierarchy

```
BaseDb (abstract)
├── Browser: Db (src/browser/db/Db.ts)
└── Node: Db (src/node/db/Db.ts)
```

### Method Signature

```typescript
// Option 1: SQL tag function
liveQuery<T>(queryFn: (sql: SQLTag) => SQL): Observable<T[]>

// Option 2: Drizzle query builder (browser only)
liveQuery<T>(query: DrizzleQuery): Observable<T[]>
```

**Parameters:**
- `queryFn`: Function that receives a `sql` tag function and returns a SQL query
- OR `query`: Drizzle query builder (not executed, passed directly to reactiveQuery)

**Returns:**
- `Observable<T[]>`: RxJS Observable that emits arrays of type `T` whenever the query results change

**Note**: The method signature is simplified to match SQLocal's API. Internally, we'll wrap SQLocal's subscription-based API into an RxJS Observable.

## Browser Implementation

### Technology Stack

- **SQLocal**: `sqlocal/drizzle` package (already installed: v0.16.0)
- **RxJS**: For Observable interface (already installed: v7.8.1)
- **SQLocalDrizzle**: Current database driver used in browser environment

### Implementation Details

#### 1. SQLocal ReactiveQuery API

Based on the [SQLocal documentation](https://sqlocal.dev/api/reactivequery#usage), the `reactiveQuery` API works as follows:

**Key Requirements:**
- Must initialize SQLocal with `reactive: true` option
- `reactiveQuery` is accessed from the SQLocal instance (or SQLocalDrizzle instance)
- Takes a function that receives a `sql` tag function: `reactiveQuery((sql) => sql\`SELECT ...\`)`
- Can also accept Drizzle query builders directly (without executing them)
- Returns an object with a `subscribe` method
- Automatically re-runs when tables read by the query are updated
- Works across multiple SQLocal instances with `reactive: true` (even in other tabs/windows)

**Current Setup:**
```typescript
// src/browser/db/Db.ts (line 72)
const { driver, batchDriver } = new SQLocalDrizzle(`${this.filesDir}/db/seed.db`)
```

**Required Changes:**
1. Initialize SQLocalDrizzle with `reactive: true` option
2. Store reference to the SQLocalDrizzle instance to access `reactiveQuery`
3. Wrap SQLocal's subscription API into RxJS Observable

#### 2. Updated prepareDb Implementation

```typescript
// src/browser/db/Db.ts

static async prepareDb(filesDir: string) {
  logger('[Db.prepareDb] preparing database')
  
  this.filesDir = filesDir
  
  // ... existing drizzle files setup ...
  
  // Initialize SQLocalDrizzle with reactive: true
  const sqlocalDrizzle = new SQLocalDrizzle(`${this.filesDir}/db/seed.db`, {
    reactive: true  // Enable reactive queries
  })
  
  const { driver, batchDriver } = sqlocalDrizzle
  
  // Store SQLocalDrizzle instance for reactive queries
  this.sqlocalInstance = sqlocalDrizzle
  
  this.appDb = drizzle(
    driver, 
    batchDriver, 
    { 
      schema, 
    })
  
  logger('[Db.prepareDb] database prepared')
  
  await this.migrate()
  
  return this.appDb
}
```

#### 3. LiveQuery Implementation

```typescript
// src/browser/db/Db.ts

import { Observable } from 'rxjs'
import { SQLocalDrizzle } from 'sqlocal/drizzle'

class Db extends BaseDb {
  static sqlocalInstance: SQLocalDrizzle | undefined
  
  /**
   * Execute a reactive query that emits new results whenever the underlying data changes.
   * 
   * Supports two usage patterns:
   * 1. SQL tag function: liveQuery((sql) => sql`SELECT * FROM models`)
   * 2. Drizzle query builder: liveQuery(db.select().from(models))
   */
  static liveQuery<T>(
    query: ((sql: any) => any) | any
  ): Observable<T[]> {
    if (!this.sqlocalInstance) {
      throw new Error('Database not initialized. Call prepareDb first.')
    }
    
    if (!this.sqlocalInstance.reactiveQuery) {
      throw new Error('Reactive queries not enabled. Initialize SQLocalDrizzle with reactive: true.')
    }
    
    return new Observable<T[]>((subscriber) => {
      // Call SQLocal's reactiveQuery
      const reactiveQueryResult = this.sqlocalInstance!.reactiveQuery(query)
      
      // Subscribe to SQLocal's subscription API
      const subscription = reactiveQueryResult.subscribe(
        (data: T[]) => {
          // Emit data through RxJS Observable
          subscriber.next(data)
        },
        (err: Error) => {
          // Emit error through RxJS Observable
          subscriber.error(err)
        }
      )
      
      // Cleanup: unsubscribe when Observable is unsubscribed
      return () => {
        subscription.unsubscribe()
      }
    })
  }
}
```

#### 4. Integration with Drizzle

SQLocal's `reactiveQuery` supports Drizzle queries directly. You can pass a Drizzle query builder without executing it:

**Example with Drizzle query builder:**
```typescript
import { models } from '@/seedSchema'

// Pass Drizzle query directly (not executed)
const models$ = Db.liveQuery<ModelRow>(
  this.appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
)

models$.subscribe(models => {
  console.log('Models updated:', models)
})
```

**Example with SQL tag function:**
```typescript
// Use SQL tag function from reactiveQuery callback
const models$ = Db.liveQuery<ModelRow>(
  (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
)

models$.subscribe(models => {
  console.log('Models updated:', models)
})
```

**Note**: SQLocal automatically detects which tables are read by the query and re-runs the query whenever those tables are updated (via INSERT, UPDATE, or DELETE operations).

## Node Implementation

### Technology Stack

- **RxJS**: For Observable interface (already installed: v7.8.1)
- **@libsql/client**: Current database client used in node environment
- **Drizzle ORM**: For query execution

### Implementation Details

#### 1. Stub Implementation (Initial)

For the initial implementation, we'll create a polling-based reactive query:

```typescript
// src/node/db/Db.ts

import { Observable, interval, switchMap, distinctUntilChanged } from 'rxjs'
import { sql } from 'drizzle-orm'

class Db extends BaseDb {
  static liveQuery<T>(sql: string, params?: any[]): Observable<T[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call prepareDb first.')
    }
    
    // Polling interval (configurable, default: 1000ms)
    const pollInterval = 1000
    
    return interval(pollInterval).pipe(
      switchMap(async () => {
        // Execute query using Drizzle
        const result = await this.db.execute(sql.raw(sql, params || []))
        return result.rows as T[]
      }),
      distinctUntilChanged((prev, curr) => {
        // Only emit if results actually changed
        return JSON.stringify(prev) === JSON.stringify(curr)
      })
    )
  }
}
```

#### 2. Future Enhancements

The node implementation can be enhanced with:

1. **Database Triggers**: Create SQLite triggers that emit events on data changes
2. **Change Streams**: If using a database that supports change streams (e.g., Turso)
3. **Event-Based Polling**: Poll only when specific tables change
4. **WebSocket Integration**: For remote databases that support real-time updates

**Future Implementation Pattern:**
```typescript
// Enhanced node implementation (future)
static liveQuery<T>(sql: string, params?: any[]): Observable<T[]> {
  // 1. Parse SQL to determine which tables are queried
  const tables = this._extractTablesFromQuery(sql)
  
  // 2. Set up triggers or change listeners for those tables
  // 3. Emit only when relevant tables change
  // 4. Re-execute query and emit new results
}
```

## BaseDb Abstract Method

### Interface Definition

```typescript
// src/db/Db/BaseDb.ts

import { Observable } from 'rxjs'

export abstract class BaseDb implements IDb {
  // ... existing methods ...
  
  /**
   * Execute a reactive query that emits new results whenever the underlying data changes.
   * 
   * Supports two usage patterns:
   * 1. SQL tag function: liveQuery((sql) => sql`SELECT * FROM models`)
   * 2. Drizzle query builder (browser only): liveQuery(db.select().from(models))
   * 
   * @param query - SQL query function or Drizzle query builder
   * @returns Observable that emits arrays of query results
   * 
   * @example
   * ```typescript
   * // Using SQL tag function
   * const models$ = BaseDb.liveQuery<ModelRow>(
   *   (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
   * )
   * 
   * // Using Drizzle query builder (browser only)
   * const models$ = BaseDb.liveQuery<ModelRow>(
   *   appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
   * )
   * 
   * models$.subscribe(models => {
   *   console.log('Models updated:', models)
   * })
   * ```
   */
  static liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]> {
    return this.PlatformClass.liveQuery<T>(query)
  }
}
```

## Usage Examples

### 1. React Hook for Live Queries

```typescript
// src/browser/react/liveQuery.ts

import { useEffect, useState } from 'react'
import { BaseDb } from '@/db/Db/BaseDb'

export function useLiveQuery<T>(
  query: ((sql: any) => any) | any
): T[] | undefined {
  const [data, setData] = useState<T[] | undefined>(undefined)
  
  useEffect(() => {
    const subscription = BaseDb.liveQuery<T>(query).subscribe({
      next: (results) => setData(results),
      error: (err) => console.error('Live query error:', err),
    })
    
    return () => subscription.unsubscribe()
  }, [query]) // Note: query should be stable or memoized
  
  return data
}
```

**Alternative: Using SQLocal's built-in React hook**

SQLocal provides a `useReactiveQuery` hook that we can leverage:

```typescript
// src/browser/react/liveQuery.ts

import { useReactiveQuery } from 'sqlocal/react'
import { BaseDb } from '@/db/Db/BaseDb'

export function useLiveQuery<T>(
  query: ((sql: any) => any) | any
) {
  // Get SQLocal instance from BaseDb
  const sqlocalInstance = BaseDb.getSQLocalInstance() // Need to add this method
  
  return useReactiveQuery(sqlocalInstance, query)
}
```

### 2. Model Schema Updates (SQL Tag Function)

```typescript
// Example: Watch for model schema changes using SQL tag function
const models$ = BaseDb.liveQuery<ModelRow>(
  (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
)

models$.subscribe(models => {
  // Update Schema.models property reactively
  schema._updateModelsFromDb(models)
})
```

### 3. Model Schema Updates (Drizzle Query Builder)

```typescript
// Example: Watch for model schema changes using Drizzle query builder
import { models } from '@/seedSchema'
import { eq } from 'drizzle-orm'

const appDb = BaseDb.getAppDb()
const models$ = BaseDb.liveQuery<ModelRow>(
  appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
)

models$.subscribe(models => {
  // Update Schema.models property reactively
  schema._updateModelsFromDb(models)
})
```

### 4. ModelProperty Updates

```typescript
// Example: Watch for property changes
import { properties } from '@/seedSchema'
import { eq } from 'drizzle-orm'

const appDb = BaseDb.getAppDb()
const properties$ = BaseDb.liveQuery<PropertyRow>(
  appDb.select().from(properties).where(eq(properties.modelId, modelId))
)

properties$.subscribe(properties => {
  // Update Model.properties reactively
  model._updatePropertiesFromDb(properties)
})
```

### 5. Schema Updates

```typescript
// Example: Watch for schema metadata changes
import { modelSchemas } from '@/seedSchema'
import { eq } from 'drizzle-orm'

const appDb = BaseDb.getAppDb()
const schemas$ = BaseDb.liveQuery<SchemaRow>(
  appDb.select().from(modelSchemas).where(eq(modelSchemas.id, schemaId))
)

schemas$.subscribe(schemaData => {
  // Update Schema instance reactively
  schema._updateFromDb(schemaData)
})
```

## Integration with Existing Architecture

### Current Data Flow

```
Database → Initial Load → Actor Context → Proxy Getters → React Components
```

### Enhanced Data Flow with Live Queries

```
Database → Live Query → Observable → Actor Context Update → Proxy Getters → React Components
         ↑                                                                    ↓
         └─────────────────────── Change Detection ─────────────────────────┘
```

### Integration Points

1. **Schema Class**: Use `liveQuery` to watch `model_schemas` table
2. **Model Class**: Use `liveQuery` to watch `models` table
3. **ModelProperty Class**: Use `liveQuery` to watch `properties` table
4. **React Hooks**: Create `useLiveQuery` hook for direct React integration

### Conflict Detection

Live queries can enhance conflict detection:

```typescript
// Watch for external changes
const externalChanges$ = BaseDb.liveQuery<ChangeRow>(
  sql`SELECT * FROM metadata WHERE updated_at > ${lastChecked}`
)

externalChanges$.subscribe(changes => {
  // Check for conflicts
  schema._checkForConflicts(changes)
})
```

## Error Handling

### Error Scenarios

1. **Database not initialized**: Throw error with clear message
2. **Invalid SQL**: Let database throw error, propagate through Observable
3. **Connection loss**: Emit error through Observable, allow retry logic
4. **Query timeout**: Implement timeout handling

### Error Handling Pattern

```typescript
static liveQuery<T>(sql: string, params?: any[]): Observable<T[]> {
  return new Observable<T[]>((subscriber) => {
    try {
      if (!this.isAppDbReady()) {
        throw new Error('Database not initialized. Call prepareDb first.')
      }
      
      // ... query setup ...
      
    } catch (error) {
      subscriber.error(error)
    }
  })
}
```

## Performance Considerations

### Browser Implementation

- **SQLocal's native reactivity**: Efficient database-level change detection built into SQLite
- **Change detection**: Automatically detects INSERT, UPDATE, DELETE operations on queried tables
- **Cross-instance reactivity**: Works across multiple SQLocal instances with `reactive: true` (even in other tabs/windows)
- **Transaction safety**: Mutations inside transactions don't trigger reactive queries until committed
- **Memory**: Unsubscribe from observables when components unmount
- **Performance**: Only re-runs queries when tables read by the query are actually updated

### Node Implementation (Stub)

- **Polling interval**: Configurable (default 1000ms)
- **Change detection**: Use `distinctUntilChanged` to avoid unnecessary emissions
- **Query optimization**: Cache query results, only re-execute when needed

### Optimization Strategies

1. **Debouncing**: Debounce rapid changes
2. **Throttling**: Throttle emissions if needed
3. **Query caching**: Cache query results, only emit on actual changes
4. **Selective subscriptions**: Only subscribe to queries that are actively used

## Testing Strategy

### Unit Tests

1. **Browser Implementation**:
   - Test `liveQuery` returns Observable
   - Test Observable emits initial results
   - Test Observable emits on data changes
   - Test error handling

2. **Node Implementation**:
   - Test polling mechanism
   - Test `distinctUntilChanged` behavior
   - Test error handling

### Integration Tests

1. **React Hook Integration**:
   - Test `useLiveQuery` hook
   - Test automatic re-renders
   - Test cleanup on unmount

2. **Schema/Model Integration**:
   - Test reactive updates to Schema instances
   - Test reactive updates to Model instances
   - Test conflict detection with live queries

### E2E Tests

1. **Browser**: Test live queries in actual browser environment
2. **Node**: Test polling behavior in node environment

## Migration Path

### Phase 1: Browser Implementation (Immediate)

1. ✅ Research SQLocal's `reactiveQuery` API - [Documentation reviewed](https://sqlocal.dev/api/reactivequery#usage)
2. ⏳ Update `prepareDb` to initialize SQLocalDrizzle with `reactive: true`
3. ⏳ Store SQLocalDrizzle instance reference in browser `Db` class
4. ⏳ Add `liveQuery` method to browser `Db` class (wrap SQLocal's subscription API)
5. ⏳ Add abstract method to `BaseDb`
6. ⏳ Test browser implementation
7. ⏳ Create `useLiveQuery` React hook (or leverage SQLocal's `useReactiveQuery`)
8. ⏳ Integrate with Schema/Model classes

### Phase 2: Node Stub Implementation

1. ✅ Add `liveQuery` method to node `Db` class (polling-based)
2. ✅ Test node implementation
3. ✅ Document limitations of stub implementation

### Phase 3: Future Enhancements

1. ⏳ Enhance node implementation with triggers/change streams
2. ⏳ Add query optimization features
3. ⏳ Add performance monitoring
4. ⏳ Add query debugging tools

## Dependencies

### Already Installed

- ✅ `rxjs`: ^7.8.1
- ✅ `sqlocal`: ^0.16.0
- ✅ `drizzle-orm`: ^0.44.3

### No Additional Dependencies Required

All necessary dependencies are already installed.

## API Reference

### BaseDb.liveQuery

```typescript
static liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]>
```

**Description**: Execute a reactive query that emits new results whenever the underlying data changes. The query automatically re-runs whenever the tables it reads from are updated (INSERT, UPDATE, DELETE).

**Parameters**:
- `query`: Either:
  - A function that receives a `sql` tag function: `(sql) => sql\`SELECT ...\``
  - A Drizzle query builder (browser only): `db.select().from(table)`

**Returns**: `Observable<T[]>` - RxJS Observable that emits query results

**Throws**: 
- `Error`: If database is not initialized
- `Error`: If reactive queries are not enabled (need `reactive: true` in SQLocal initialization)

**Browser Behavior**:
- Automatically detects changes to queried tables
- Works across multiple SQLocal instances with `reactive: true`
- Changes in transactions don't trigger until commit
- DELETE statements without WHERE/RETURNING/triggers may not trigger (SQLite "Truncate Optimization")

**Example with SQL tag function**:
```typescript
const models$ = BaseDb.liveQuery<ModelRow>(
  (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
)

models$.subscribe(models => {
  console.log('Models:', models)
})
```

**Example with Drizzle query builder**:
```typescript
import { models } from '@/seedSchema'
import { eq } from 'drizzle-orm'

const appDb = BaseDb.getAppDb()
const models$ = BaseDb.liveQuery<ModelRow>(
  appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
)

models$.subscribe(models => {
  console.log('Models:', models)
})
```

## Implementation Notes

### SQLocal ReactiveQuery Details

Based on the [SQLocal documentation](https://sqlocal.dev/api/reactivequery#usage):

1. **Initialization**: Must set `reactive: true` when creating SQLocalDrizzle instance
2. **API Pattern**: `reactiveQuery(query).subscribe((data) => {}, (err) => {})`
3. **Change Detection**: Automatically detects changes to tables read by the query
4. **Cross-Instance**: Works across multiple SQLocal instances with `reactive: true` (even in other tabs)
5. **Transaction Safety**: Changes in transactions don't trigger until commit
6. **Drizzle Support**: Can pass Drizzle query builders directly (without executing)
7. **SQL Tag**: Provides `sql` tag function in callback for type-safe SQL

### Known Limitations

1. **SQLite Truncate Optimization**: DELETE statements without WHERE/RETURNING/triggers may not trigger reactive queries
2. **Node Implementation**: Currently uses polling (stub implementation)
3. **Query Stability**: For React hooks, queries should be stable or memoized to avoid re-subscriptions

### Future Enhancements

1. **Node Implementation**: Enhance with database triggers or change streams
2. **Query Optimization**: Add query result caching if needed
3. **Performance Monitoring**: Add metrics for reactive query performance
4. **Query Debugging**: Add tools to debug reactive query subscriptions

## Conclusion

This design provides a foundation for reactive database queries in the Seed Protocol SDK. The browser implementation leverages SQLocal's native reactivity, while the node implementation uses a polling-based approach that can be enhanced in the future. The design integrates seamlessly with the existing architecture and provides a clean API for reactive data access.

