# Schema Creation Flow Design

## Current State: ✅ Already Possible

**Yes, you can already call `Schema.create('new-schema-name')` and get a new Schema with no models!**

The system automatically creates a schema file when a Schema instance is created for a non-existent schema name.

## Current Flow

### 1. Schema Creation (`Schema.create()`)

```typescript
const schema = Schema.create('my-new-schema')
```

**What happens:**
1. `Schema.create()` checks the instance cache
2. If not cached, creates a new `Schema` instance
3. The Schema constructor starts an XState machine in the `'loading'` state
4. The machine automatically invokes `loadOrCreateSchema` actor

### 2. Load or Create Logic (`loadOrCreateSchema`)

The `loadOrCreateSchema` actor (in `src/schema/service/actors/loadOrCreateSchema.ts`) performs:

**Step 1: Check for Existing Schema**
- Scans for complete schema files matching the name
- If found, loads the latest version and returns it

**Step 2: Create New Schema (if not found)**
- Determines the next version number (latestVersion + 1, or 1 if none exist)
- Creates a new `SchemaFileFormat` object with:
  ```typescript
  {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: newVersion,
    id: generateId(),
    metadata: {
      name: schemaName,
      createdAt: now,
      updatedAt: now,
    },
    models: {},        // ← Empty models object
    enums: {},
    migrations: [{
      version: newVersion,
      timestamp: now,
      description: 'Initial schema',
      changes: [],
    }],
  }
  ```

**Step 3: Save to File Immediately**
- **File is written synchronously** at this point (line 105 in `loadOrCreateSchema.ts`)
- File path: `{workingDir}/{sanitizedName}-v{version}.json`
- The schema is now persisted to disk

**Step 4: Return Schema to Machine**
- Sends `loadOrCreateSchemaSuccess` event with the schema data
- Machine transitions to `'idle'` state
- Schema instance is ready to use

### 3. File Persistence Timeline

| Event | File Status | Notes |
|-------|-------------|-------|
| `Schema.create('new-schema')` called | **File created immediately** | Empty schema with no models |
| Schema instance returned | File exists on disk | Ready to use, but no models yet |
| Models added via other APIs | File unchanged | Models exist in memory/DB only |
| `schema.saveNewVersion()` called | **New version file created** | Only if `_isDraft === true` and `_editedProperties.size > 0` |

## Key Observations

### ✅ What Works Well

1. **Immediate File Creation**: The file is created as soon as `Schema.create()` is called for a new schema
2. **Empty Models Support**: The schema file is created with `models: {}`, which is valid
3. **Version Management**: Automatically handles versioning (starts at 1, increments appropriately)
4. **Idempotent**: Calling `Schema.create()` multiple times returns the same cached instance

### ⚠️ Current Behavior Considerations

1. **File Created Before Models Added**
   - The file is created immediately, even with no models
   - This might be desired (persistence) or undesired (clutter)
   - Consider: Should we have a "draft" mode that doesn't write until models are added?

2. **No Explicit Save Method for Initial Creation**
   - The file is saved automatically during `loadOrCreateSchema`
   - There's no way to create a Schema instance without creating a file
   - Consider: Should `Schema.create()` have an option to defer file creation?

3. **Subsequent Saves Require Changes**
   - `saveNewVersion()` only works if there are edited properties (`_isDraft === true`)
   - If you create a schema, add models programmatically (not via ModelProperty edits), and want to save, you'd need to trigger the draft mechanism
   - Consider: Should there be a `save()` method that always writes, regardless of draft status?

## Proposed Flow Options

### Option A: Current Behavior (Immediate Persistence)
**Status**: ✅ Already implemented

```typescript
// File created immediately
const schema = Schema.create('my-schema')
// File exists: my-schema-v1.json with models: {}

// Add models later (via other mechanisms)
// File still shows models: {} until saveNewVersion() is called
```

**Pros:**
- Simple, predictable
- Schema is always persisted
- No risk of losing schema metadata

**Cons:**
- Creates files even for "empty" schemas
- No way to create in-memory-only schemas

### Option B: Lazy File Creation (Deferred Persistence)
**Status**: ❌ Not implemented

```typescript
// No file created yet
const schema = Schema.create('my-schema', { persist: false })
// File does not exist

// Explicitly save when ready
await schema.save() // Creates file now
```

**Pros:**
- More control over when files are created
- Can create temporary/in-memory schemas
- Cleaner working directory

**Cons:**
- More complex API
- Risk of losing work if not saved
- Breaking change to current behavior

### Option C: Hybrid Approach (Draft Mode)
**Status**: ❌ Not implemented

```typescript
// Create as draft (no file yet)
const schema = Schema.create('my-schema', { draft: true })
// File does not exist

// Add models...
// When ready, promote to persisted
await schema.persist() // Creates file
// OR automatically persist when first model is added
```

**Pros:**
- Best of both worlds
- Backward compatible (default to immediate persistence)
- Clear distinction between draft and persisted

**Cons:**
- Most complex to implement
- Need to track draft state

## Recommended Approach

### For Current Use Case

**The current implementation already supports your use case!**

```typescript
// This already works:
const schema = Schema.create('new-schema-name')
// ✅ Returns Schema instance
// ✅ File is created immediately with empty models: {}
// ✅ Schema is ready to use
```

### When File is Saved

1. **Initial Creation**: File is saved **immediately** when `Schema.create()` is called for a new schema name
2. **Subsequent Updates**: File is saved when:
   - `schema.saveNewVersion()` is called
   - Only if there are edited properties (`_isDraft === true` and `_editedProperties.size > 0`)

### Adding Models to Empty Schema

After creating an empty schema, you can add models through:
- Import mechanisms (`importJsonSchema`)
- Model creation APIs
- Direct manipulation (if supported)

Then call `schema.saveNewVersion()` to persist the changes to a new version file.

## Summary

| Question | Answer |
|----------|--------|
| Can we call `Schema.create('new-schema-name')`? | ✅ **Yes, already works** |
| Does it return a Schema with no models? | ✅ **Yes, `models: {}`** |
| When is the file saved? | ✅ **Immediately upon creation** |
| Is this the desired behavior? | ⚠️ **Depends on requirements** - current behavior creates files immediately, which may or may not be desired |

## Next Steps (If Changes Needed)

If you want to modify when files are saved:

1. **Add `persist` option to `Schema.create()`**
   - Default: `true` (current behavior)
   - If `false`: Don't create file until explicit save

2. **Add `save()` method to Schema class**
   - Always writes current state to file
   - Works even without edited properties

3. **Add draft mode support**
   - Track whether schema is persisted
   - Auto-persist on first model addition (optional)
