# Model Edit Flow Refactoring Analysis

## Core Architectural Principle

**Schema should NEVER send update events to Model instances, at any time.** Model instances are independent entities that:
- Load their data directly from the database
- Know their own `schemaFileId` and can link to Schema independently
- Are cached statically by Model class (by ID and by name)
- Can be created/referenced by any entity (Schema, another Model, external code)

Schema's relationship to Model instances is **purely referential**:
- Schema knows which model IDs belong to it (via `model_schemas` join table or `models` object)
- Schema references Model instances by ID for `getContext()` and persistence
- Schema never updates Model instance state/data

## New Architecture Flow

### Loading from JSON File (First Time)
1. **Create Schema** - Load from file, generate `schemaFileId` if missing
2. **Create Models Independently** - For each model:
   - Generate `modelFileId` if missing
   - Call `Model.create(modelName, schemaName, { modelFileId })` - Model loads from database
   - Link via `schemaFileId` in database
3. **Create Properties Independently** - For each property:
   - Generate property ID if missing
   - Link to model via `modelId`
   - Link to schema via model's `schemaFileId`

### Loading from Database
1. **Query Schema** - Get `schemaFileId` from database
2. **Query Model IDs** - Use `loadModelsFromDbForSchema(schemaId)` to get model IDs
3. **Reference Model Instances** - For each model ID:
   - Call `Model.getById(modelFileId)` or `Model.create(modelName, schemaName, { modelFileId })`
   - **Don't care if instance already exists or what its state is**
   - Model instance loads its own data from database via `loadOrCreateModel`
4. **Store References** - Store in Schema's cache for `getContext()`

### Model Instance Loading
- `loadOrCreateModel` queries database FIRST using `modelFileId` or `modelName + schemaName`
- Loads properties, indexes, description from database tables
- Only checks Schema context as absolute last resort

## Current Architecture Problem

Currently, model edits flow through Schema in a bidirectional way that creates update loops and unnecessary coupling:

1. **Model Edit → Schema Update**: When a model is edited, it notifies Schema to update its `models` object
2. **Schema Update → Model Update**: When Schema's `models` data changes, it pushes updates back to Model instances

This creates a circular dependency and update loops that require complex guards to prevent.

## Current Flow: Model Edits Through Schema

### Flow 1: Model Property/Index/Description Edit

```
User edits model.property → 
  Model Proxy setter (Model.ts:317-338) →
    Model context update →
    _notifySchemaOfModelChange() (Model.ts:688-724) →
      Schema context update (models object) →
      Schema validation triggered →
      _updateModelInstances() called →
        Model instance update (Schema.ts:2240-2245) →
          Model validation triggered →
          Loop prevention guards check...
```

**Key Code Locations:**
- `src/Model/Model.ts:317-338` - Properties setter calls `_notifySchemaOfModelChange()`
- `src/Model/Model.ts:339-360` - Indexes setter calls `_notifySchemaOfModelChange()`
- `src/Model/Model.ts:361-381` - Description setter calls `_notifySchemaOfModelChange()`
- `src/Model/Model.ts:688-724` - `_notifySchemaOfModelChange()` updates Schema's `models` object
- `src/Schema/Schema.ts:220-266` - Schema subscription triggers `_updateModelInstances()` when `models` changes
- `src/Schema/Schema.ts:2230-2245` - `_updateModelInstances()` pushes updates back to Model instances

### Flow 2: Model Name Change

```
User edits model.name →
  Model Proxy setter (Model.ts:267-316) →
    Model context update →
    _notifySchemaOfNameChange() (Model.ts:673-683) →
      Schema._handleModelNameChange() →
        Schema context update (models object) →
        Schema validation triggered →
        _updateModelInstances() called →
          Model instance update...
```

**Key Code Locations:**
- `src/Model/Model.ts:267-316` - ModelName setter calls `_notifySchemaOfNameChange()`
- `src/Model/Model.ts:673-683` - `_notifySchemaOfNameChange()` calls Schema
- `src/Schema/Schema.ts:2626-2698` - `_handleModelNameChange()` updates Schema's `models` object

## Places Where Schema Updates Model Instances

### 1. `_updateModelInstances()` - Main Update Method

**Location:** `src/Schema/Schema.ts:1982-2280`

**When Called:**
- When Schema's `models` data changes (subscription handler at line 220-266)
- When Schema is reloaded from database
- When Schema loads from file system

**What It Does:**
- Creates new Model instances for models in Schema's `models` object
- Updates existing Model instances if their data differs from Schema's `models` object
- Removes Model instances for models no longer in Schema's `models` object

**Problem:** This pushes Schema's state back to Model instances, creating a circular update loop.

### 2. `_registerModelInstance()` - Model Registration

**Location:** `src/Schema/Schema.ts:2289-2622`

**When Called:**
- When a new Model instance is created with `registerWithSchema: true`
- After Model validation passes

**What It Does:**
- Updates Schema's `models` object with Model instance data
- Triggers Schema validation
- Saves draft to database
- Calls `_updateModelInstances()` (but with guards to prevent loops)

**Problem:** This updates Schema's state from Model, which then triggers `_updateModelInstances()`.

## Refactoring Strategy

### Core Principle: Schema Never Updates Model Instances

**Schema should NEVER send update events to Model instances, at any time.** Model instances load their data directly from the database.

### Goal
Make Schema's relationship to Model instances **completely read-only**. Model edits should:
1. Go directly to Model instances ✅ (already happens)
2. Model validation calls Schema validation ✅ (already happens in `validateModel.ts`)
3. Schema should NEVER update Model instance state/data ❌ (needs refactoring)
4. Model instances load their data from database, not from Schema ❌ (needs refactoring)

### Changes Needed

#### 1. Remove Model → Schema Update Notifications During Edits

**Remove/Refactor:**
- `Model._notifySchemaOfModelChange()` - Should NOT update Schema context during edits
- `Model._notifySchemaOfNameChange()` - Should NOT update Schema context during edits

**New Approach:**
- Model edits stay in Model instances only
- Schema is only updated when **persisting/saving** (via `Schema.saveNewVersion()` or `Schema._saveDraftToDb()`)
- Schema reads from Model instances when needed for persistence

#### 2. Remove ALL Schema → Model Updates

**CRITICAL:** Schema should NEVER send update events to Model instances, even during initial load.

**Refactor:**
- `Schema._updateModelInstances()` - Should ONLY reference Model instances (via `Model.getById()` or `Model.getByName()`)
- Should NOT call `Model.create()` with data
- Should NOT send `updateContext` events to Model instances
- Should NOT initialize Model instance data

**New Approach:**
- `_updateModelInstances()` should:
  - Get model IDs from Schema's `models` object or database query
  - Call `Model.getById(modelFileId)` or `Model.getByName(modelName, schemaName)` to get existing instances
  - If Model instance doesn't exist, call `Model.create()` with just the ID (no data)
  - Model instance will load its own data from database via `loadOrCreateModel`
  - Store references in Schema's cache for `getContext()`

#### 3. Model Instances Load from Database, Not Schema Context

**Current Problem:** `loadOrCreateModel` tries to load from Schema context first (lines 71-141), then falls back to database.

**New Approach:**
- `loadOrCreateModel` should load from database FIRST
- Only use Schema context as a fallback if database lookup fails
- Model instances are the source of truth; they load their own data

**Implementation:**
- Refactor `loadOrCreateModel` to query database first using `modelFileId` or `modelName + schemaName`
- Load properties, indexes, description from database tables
- Only check Schema context if database doesn't have the model yet

#### 4. Schema Loading from JSON File

**When loading from JSON file for the first time:**

1. **Create Schema instance** - Load schema metadata from file
2. **Generate IDs if missing** - If file has no `schemaFileId`, generate one
3. **Create Model instances independently** - For each model in file:
   - Generate `modelFileId` if missing
   - Call `Model.create(modelName, schemaName, { modelFileId })` - Model will load from database
   - Link via `schemaFileId` in database
4. **Create Property instances independently** - For each property:
   - Generate property ID if missing
   - Link to model via `modelId`
   - Link to schema via model's `schemaFileId`

**Key Point:** Everything is created independently and linked via IDs. Schema doesn't push data to Model instances.

#### 5. Schema Loading from Database

**When loading from database:**

1. **Query schema record** - Get schema metadata and `schemaFileId`
2. **Query model IDs** - Use `loadModelsFromDbForSchema(schemaId)` to get model IDs
3. **Reference Model instances** - For each model ID:
   - Call `Model.getById(modelFileId)` or `Model.create(modelName, schemaName, { modelFileId })`
   - Don't care if instance already exists or what its state is
   - Model instance will have its own data from database
4. **Store references** - Store Model instance references in Schema's cache for `getContext()`

**Key Point:** Schema is ambivalent about Model instance state. It just references them by ID.

#### 6. Schema Reads from Model Instances for Persistence

**Current:** Schema's `models` object is the source of truth, and it pushes to Model instances.

**New:** Model instances are the source of truth for edits. Schema reads from Model instances when:
- Saving to file (`Schema.saveNewVersion()`)
- Saving draft to database (`Schema._saveDraftToDb()`)

**Implementation:**
- `Schema.saveNewVersion()` should read from Model instances in `instanceState.modelInstancesById` instead of Schema's `models` object
- `Schema._saveDraftToDb()` should read from Model instances instead of Schema's `models` object

#### 7. Keep Model Validation Calling Schema Validation

**Current:** ✅ Already correct
- `Model.validate()` calls `SchemaValidationService.validateModelAgainstSchema()`
- This validates Model data against Schema's structure without updating Schema

**No changes needed here.**

## Detailed Refactoring Plan

### Phase 1: Remove Model → Schema Update Notifications

**File: `src/Model/Model.ts`**

1. **Remove `_notifySchemaOfModelChange()` calls from setters:**
   - Line 335: Remove from `properties` setter
   - Line 357: Remove from `indexes` setter  
   - Line 378: Remove from `description` setter

2. **Remove `_notifySchemaOfNameChange()` call:**
   - Line 312: Remove from `modelName` setter

3. **Keep the methods but change their purpose:**
   - These methods could be used for **read-only** operations (like checking if Schema knows about the model)
   - Or remove them entirely if not needed

### Phase 2: Remove ALL Schema → Model Updates

**File: `src/Schema/Schema.ts`**

1. **Refactor `_updateModelInstances()` (line 1982):**
   - Remove ALL `updateContext` calls to Model instances (lines 2160-2177, 2240-2245)
   - Remove ALL `initializeOriginalValues` calls to Model instances (lines 2181-2190)
   - Change to only reference Model instances:
     - Get model IDs from Schema's `models` object or database
     - Call `Model.getById(modelFileId)` or `Model.getByName(modelName, schemaName)`
     - If Model instance doesn't exist, call `Model.create()` with just the ID (no data)
     - Model instance will load its own data from database
   - Store references in Schema's cache for `getContext()`

2. **Update subscription handler (line 220-266):**
   - Don't call `_updateModelInstances()` when `models` changes due to Model edits
   - Only call it during initial load or explicit reload
   - When called, it should only reference Model instances, not update them

**File: `src/Model/service/actors/loadOrCreateModel.ts`**

3. **Refactor `loadOrCreateModel` to load from database first:**
   - Remove Schema context lookup (lines 71-141)
   - Query database FIRST using `modelFileId` or `modelName + schemaName`
   - Load properties, indexes, description from database tables
   - Only check Schema context as absolute last resort if database doesn't have the model

### Phase 3: Schema Reads from Model Instances for Persistence

**File: `src/Schema/Schema.ts`**

1. **Refactor `saveNewVersion()` (line 976):**
   - Instead of reading from `context._editedProperties` and Schema's `models` object
   - Read from Model instances in `instanceState.modelInstancesById`
   - Build the schema file structure from Model instance data

2. **Refactor `_saveDraftToDb()` (line 1251):**
   - Instead of reading from Schema's `models` object
   - Read from Model instances in `instanceState.modelInstancesById`
   - Build the database structure from Model instance data

### Phase 4: Handle Model Registration

**File: `src/Schema/Schema.ts`**

1. **Refactor `_registerModelInstance()` (line 2289):**
   - Don't update Schema's `models` object immediately
   - Just add the Model instance to `instanceState.modelInstancesById`
   - Schema's `models` object is only updated when reading from file/database

## Benefits of This Refactoring

1. **Eliminates Update Loops**: No more circular updates between Model and Schema
2. **Clearer Ownership**: Model instances own their edit state; Schema is read-only reference
3. **Simpler Logic**: No need for complex loop prevention guards
4. **Better Performance**: Fewer unnecessary updates and validations
5. **Easier to Reason About**: Clear unidirectional flow: Model edits → Model validation → Schema validation (read-only)

## Migration Considerations

1. **Initial Load from JSON File**:
   - Generate `schemaFileId` if missing
   - For each model, generate `modelFileId` if missing
   - Call `Model.create()` with just the ID (no data)
   - Model instances will load their data from database
   - Link everything via IDs in database

2. **Initial Load from Database**:
   - Query schema record to get `schemaFileId`
   - Query `model_schemas` join table to get model IDs
   - Call `Model.getById()` or `Model.create()` with model IDs
   - Don't care about Model instance state - they load their own data

3. **Reload**: When Schema is reloaded, it should:
   - Get fresh model IDs from database
   - Reference Model instances by ID
   - **Never update Model instances** - they are independent

4. **Backward Compatibility**: Existing code that expects Schema's `models` to reflect Model edits will need to be updated to read from Model instances instead

