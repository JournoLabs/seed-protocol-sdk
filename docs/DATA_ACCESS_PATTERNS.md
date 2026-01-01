# Data Access and Management Patterns

This document describes the data access and management patterns used in the Seed Protocol SDK, specifically for `Schema`, `Model`, and `ModelProperty` classes.

## Overview

The SDK uses a **single-writer pattern** with **optimistic conflict detection**:

- **During Initialization**: Database is the source of truth → Actor Context (one-way load)
- **After Initialization**: Actor Context is the source of truth → Database (one-way writes)

This pattern ensures that:
1. Data is loaded from the database during initialization
2. All changes flow through the actor context (XState machines)
3. Changes are automatically validated and persisted
4. Conflicts are detected before writes to prevent data loss

## Architecture

### Core Components

1. **Actor Services (XState Machines)**: Manage state and handle state transitions
2. **Reactive Proxies**: Intercept property access/assignment to read from/write to actor context
3. **Validation System**: Automatically validates changes before persistence
4. **Conflict Detection**: Prevents overwriting external changes

### Data Flow

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
│  React Re-render│ (via XState subscriptions)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Save to DB     │ (with conflict check)
└─────────────────┘
```

## Writing Data

### Pattern Flow

1. **User sets property value** via Proxy setter
   ```typescript
   schema.name = 'New Schema Name'
   ```

2. **Validation happens automatically** via machine actor
   - For `ModelProperty`: Automatic validation on property set
   - For `Model`: Automatic validation on property set
   - For `Schema`: Automatic validation on property set

3. **If valid, new value sent via internal machine event** to update context
   ```typescript
   service.send({ type: 'updateContext', name: 'New Schema Name' })
   ```

4. **XState reactivity propagates change** via actor context
   - Context is updated using `assign` action
   - All subscribers receive the update

5. **Instance Proxy setter triggers React re-renders**
   - React hooks that subscribe to the actor service automatically re-render
   - No explicit React signaling needed (handled by XState subscriptions)

6. **Actor context updates trigger DB writes**
   - `_saveDraftToDb()` is called automatically for tracked properties
   - Conflict detection runs before write

### Example: Setting a Schema Property

```typescript
// User sets property
schema.name = 'My Schema'

// Behind the scenes:
// 1. Proxy setter intercepts
// 2. Sends updateContext event to machine
// 3. Machine validates (automatic)
// 4. Updates context if valid
// 5. XState notifies subscribers (React re-renders)
// 6. _saveDraftToDb() is called automatically
// 7. Conflict check runs before DB write
```

## Reading Data

### Pattern Flow

1. **Properties read from actor context** via Proxy getter
   ```typescript
   const name = schema.name // Reads from actor context
   ```

2. **Actor context is the source of truth** after initialization
   - All reads go through the Proxy to actor context
   - No direct database reads after initialization

3. **Initial load happens during construction**
   - `loadOrCreateSchema` actor loads from DB/file
   - Context is populated with loaded data
   - Conflict detection metadata is tracked

## Conflict Detection

### How It Works

The SDK uses **optimistic locking** with timestamp/version comparison:

1. **Track load metadata** when data is loaded:
   - `_loadedAt`: Timestamp when data was loaded
   - `_dbVersion`: Database version at load time
   - `_dbUpdatedAt`: Database `updatedAt` timestamp at load time

2. **Check for conflicts before writes**:
   - Compare current DB `updatedAt` with `_dbUpdatedAt`
   - If DB was updated after load → conflict detected

3. **Handle conflicts**:
   - Throw `ConflictError` with conflict details
   - Application can reload and retry

### Conflict Detection Metadata

```typescript
type SchemaMachineContext = {
  // ... schema data ...
  _loadedAt?: number      // When data was loaded from DB
  _dbVersion?: number      // DB version at load time
  _dbUpdatedAt?: number    // DB updatedAt at load time (milliseconds)
}
```

### Example: Conflict Detection

```typescript
try {
  schema.name = 'New Name'
  await schema.saveNewVersion()
} catch (error) {
  if (error instanceof ConflictError) {
    console.log('Conflict detected!')
    console.log('Local version:', error.conflict.localVersion)
    console.log('DB version:', error.conflict.dbVersion)
    console.log('DB was updated at:', error.conflict.dbUpdatedAt)
    
    // Reload and retry
    await schema.reload()
    schema.name = 'New Name'
    await schema.saveNewVersion()
  }
}
```

## Validation

### Automatic Validation

All three classes (`Schema`, `Model`, `ModelProperty`) automatically validate on property changes:

- **ModelProperty**: Validates property structure and schema constraints
- **Model**: Validates model structure and relationships
- **Schema**: Validates schema structure and consistency

### Validation Flow

```typescript
// Property set triggers validation automatically
schema.version = 2
// → Machine transitions to 'validating' state
// → Validation actor runs
// → If invalid, errors stored in context
// → If valid, context updated and saved
```

### Manual Validation

You can also validate manually:

```typescript
const result = await schema.validate()
if (!result.isValid) {
  console.log('Validation errors:', result.errors)
}
```

## Database Persistence

### Automatic Persistence

All tracked property changes automatically trigger database saves:

**Schema tracked properties:**
- `$schema`, `version`, `metadata`, `enums`, `migrations`, `models`, `name`, `createdAt`, `updatedAt`

**Model tracked properties:**
- `modelName`, `schemaName`, `description`, `properties`, `indexes`

**ModelProperty tracked properties:**
- `name`, `dataType`, `ref`, `modelId`, `refModelId`, `refValueType`, `storageType`, `localStorageDir`, `filenameSuffix`, `modelName`, `refModelName`

### Save Methods

1. **`_saveDraftToDb()`**: Saves immediately as draft (no file version)
   - Called automatically on property changes
   - Includes conflict detection

2. **`saveNewVersion()`**: Creates new schema version (writes file + DB)
   - Validates before saving
   - Includes conflict detection
   - Clears draft flags

## Reload Mechanism

### Reload Methods

All classes provide a `reload()` method to refresh from the database:

```typescript
// Reload Schema from database
await schema.reload()

// Reload Model from Schema context
await model.reload()

// ModelProperty reload (note: properties reload with parent)
await property.reload() // Placeholder for API consistency
```

### When to Reload

- After catching a `ConflictError`
- When you suspect data may have changed externally
- After external database updates
- To refresh stale data

## Best Practices

### 1. Handle Conflicts Gracefully

```typescript
async function updateSchemaSafely(schema: Schema, updates: any) {
  try {
    Object.assign(schema, updates)
    await schema.saveNewVersion()
  } catch (error) {
    if (error instanceof ConflictError) {
      // Reload and retry
      await schema.reload()
      Object.assign(schema, updates)
      await schema.saveNewVersion()
    } else {
      throw error
    }
  }
}
```

### 2. Use Validation Results

```typescript
const result = await schema.validate()
if (!result.isValid) {
  // Handle validation errors
  result.errors.forEach(error => {
    console.error(`${error.field}: ${error.message}`)
  })
}
```

### 3. Monitor for Conflicts

```typescript
// Check for conflicts before critical operations
const conflictCheck = await schema._checkForConflicts()
if (conflictCheck.hasConflict) {
  await schema.reload()
}
```

### 4. Batch Updates

```typescript
// Multiple property updates are batched automatically
schema.name = 'New Name'
schema.version = 2
schema.metadata = { ... }
// All changes saved together in _saveDraftToDb()
```

## React Integration

### Subscribing to Changes

React hooks automatically re-render when actor context changes:

```typescript
import { useActor } from '@xstate/react'

function SchemaComponent({ schema }: { schema: Schema }) {
  const [state] = useActor(schema.getService())
  
  // Automatically re-renders when schema.name changes
  return <div>{state.context.metadata?.name}</div>
}
```

### Why It Works

1. Proxy setter updates actor context
2. XState notifies all subscribers
3. React hooks that subscribe to the service re-render
4. No explicit React signaling needed

## Error Handling

### ConflictError

```typescript
import { ConflictError } from '@/schema/errors'

try {
  await schema.saveNewVersion()
} catch (error) {
  if (error instanceof ConflictError) {
    // Access conflict details
    const { localVersion, dbVersion, dbUpdatedAt } = error.conflict
    // Handle conflict...
  }
}
```

### Validation Errors

```typescript
const errors = schema.validationErrors
if (errors.length > 0) {
  errors.forEach(error => {
    console.error(`${error.field}: ${error.message}`)
  })
}
```

## Summary

The SDK's data access pattern provides:

✅ **Single source of truth** (actor context after init)  
✅ **Automatic validation** on all property changes  
✅ **Automatic persistence** to database  
✅ **Conflict detection** to prevent data loss  
✅ **Reactive updates** via XState subscriptions  
✅ **Reload mechanism** to refresh stale data  

This pattern ensures data consistency, prevents conflicts, and provides a smooth developer experience with automatic validation and persistence.

