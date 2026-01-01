# ModelProperty Edit Flow Refactoring Analysis

## Core Architectural Principle

**Model should NEVER send update events to ModelProperty instances, at any time.** ModelProperty instances are independent entities that:
- Load their data directly from the database
- Know their own `modelId` and can link to Model independently
- Are cached statically by ModelProperty class (by ID and by name)
- Can be created/referenced by any entity (Model, Schema, external code)

Model's relationship to ModelProperty instances is **purely referential**:
- Model knows which property IDs belong to it (via `properties` table or `properties` object)
- Model references ModelProperty instances by ID for `getContext()` and persistence
- Model never updates ModelProperty instance state/data

## New Architecture Flow

### Loading from JSON File (First Time)
1. **Create Model** - Load from file/database, generate `modelFileId` if missing
2. **Create Properties Independently** - For each property:
   - Generate property ID if missing
   - Call `ModelProperty.create(propertyData)` - ModelProperty loads from database
   - Link via `modelId` in database
3. **Link via IDs** - Everything is linked via IDs in database

### Loading from Database
1. **Query Model** - Get `modelFileId` from database
2. **Query Property IDs** - Use `loadPropertiesFromDbForModel(modelId)` to get property IDs
3. **Reference ModelProperty Instances** - For each property ID:
   - Call `ModelProperty.getById(propertyId)` or `ModelProperty.create(propertyData)`
   - **Don't care if instance already exists or what its state is**
   - ModelProperty instance loads its own data from database
4. **Store References** - Store in Model's cache for `getContext()`

### ModelProperty Instance Loading
- `ModelProperty.create()` queries database FIRST using `propertyId` or `modelName + propertyName`
- Loads property data from database tables
- Only checks Model context as absolute last resort

## Current Architecture Problem

Currently, property edits may flow through Model in a bidirectional way that could create update loops and unnecessary coupling:

1. **ModelProperty Edit → Model Update**: When a property is edited, it may notify Model to update its `properties` object
2. **Model Update → ModelProperty Update**: When Model's `properties` data changes, it might push updates back to ModelProperty instances

This could create a circular dependency and update loops that require complex guards to prevent.

## Refactoring Strategy

### Core Principle: Model Never Updates ModelProperty Instances

**Model should NEVER send update events to ModelProperty instances, at any time.** ModelProperty instances load their data directly from the database.

### Goal
Make Model's relationship to ModelProperty instances **completely read-only**. ModelProperty edits should:
1. Go directly to ModelProperty instances ✅ (already happens)
2. ModelProperty validation calls Schema validation ✅ (already happens)
3. Model should NEVER update ModelProperty instance state/data ❌ (needs refactoring)
4. ModelProperty instances load their data from database, not from Model ❌ (needs refactoring)

### Changes Needed

#### 1. Remove ModelProperty → Model Update Notifications During Edits

**Current:** ModelProperty may update Model's `properties` object during edits.

**New Approach:**
- ModelProperty edits stay in ModelProperty instances only
- Model is only updated when **persisting/saving** (via `Model.saveNewVersion()` or `Model._saveDraftToDb()`)
- Model reads from ModelProperty instances when needed for persistence

#### 2. Remove ALL Model → ModelProperty Updates

**CRITICAL:** Model should NEVER send update events to ModelProperty instances, even during initial load.

**Refactor:**
- Model should ONLY reference ModelProperty instances (via `ModelProperty.getById()` or `ModelProperty.getByName()`)
- Should NOT call `ModelProperty.create()` with data to push updates
- Should NOT send `updateContext` events to ModelProperty instances
- Should NOT initialize ModelProperty instance data

**New Approach:**
- Model should:
  - Get property IDs from Model's `properties` object or database query
  - Call `ModelProperty.getById(propertyId)` or `ModelProperty.getByName(modelName, propertyName)` to get existing instances
  - If ModelProperty instance doesn't exist, call `ModelProperty.create()` with just the ID (no data)
  - ModelProperty instance will load its own data from database
  - Store references in Model's cache for `getContext()`

#### 3. ModelProperty Instances Load from Database, Not Model Context

**Current Problem:** ModelProperty may try to load from Model context first, then fall back to database.

**New Approach:**
- ModelProperty should load from database FIRST
- Only use Model context as a fallback if database lookup fails
- ModelProperty instances are the source of truth; they load their own data

**Implementation:**
- Refactor ModelProperty creation to query database first using `propertyId` or `modelName + propertyName`
- Load property data from database tables
- Only check Model context if database doesn't have the property yet

#### 4. Model Loading from JSON File
**When loading from JSON file for the first time:**

1. **Create Model instance** - Load model metadata from file
2. **Generate IDs if missing** - If file has no `modelFileId`, generate one
3. **Create Property instances independently** - For each property in file:
   - Generate property ID if missing
   - Call `ModelProperty.create(propertyData)` - ModelProperty will load from database
   - Link via `modelId` in database

**Key Point:** Everything is created independently and linked via IDs. Model doesn't push data to ModelProperty instances.

#### 5. Model Loading from Database
**When loading from database:**

1. **Query model record** - Get model metadata and `modelFileId`
2. **Query property IDs** - Use `loadPropertiesFromDbForModel(modelId)` to get property IDs
3. **Reference ModelProperty instances** - For each property ID:
   - Call `ModelProperty.getById(propertyId)` or `ModelProperty.create(propertyData)`
   - Don't care if instance already exists or what its state is
   - ModelProperty instance will have its own data from database
4. **Store references** - Store ModelProperty instance references in Model's cache for `getContext()`

**Key Point:** Model is ambivalent about ModelProperty instance state. It just references them by ID.

#### 6. Model Reads from ModelProperty Instances for Persistence

**Current:** Model's `properties` object is the source of truth, and it might push to ModelProperty instances.

**New:** ModelProperty instances are the source of truth for edits. Model reads from ModelProperty instances when:
- Saving to file (`Model.saveNewVersion()`)
- Saving draft to database (`Model._saveDraftToDb()`)

**Implementation:**
- `Model.saveNewVersion()` should read from ModelProperty instances in `instanceState.propertyInstancesById` instead of Model's `properties` object
- `Model._saveDraftToDb()` should read from ModelProperty instances instead of Model's `properties` object

#### 7. Keep ModelProperty Validation Calling Schema Validation

**Current:** ✅ Already correct
- `ModelProperty.validate()` calls `SchemaValidationService.validatePropertyAgainstSchema()`
- This validates ModelProperty data against Schema's structure without updating Schema

**No changes needed here.**

#### 8. ModelProperty Can Notify Model/Schema of Changes (for Draft Flags)

**Current:** ✅ Already correct
- `ModelProperty.compareAndMarkDraft` notifies Schema when property is edited
- This is for draft flagging only, not for updating Model/Schema state

**No changes needed here.**

## Detailed Refactoring Plan

### Phase 1: Add Model Instance State Tracking

**File: `src/Model/Model.ts`**

1. **Add WeakMap for instance state** (similar to Schema):
   ```typescript
   const modelInstanceState = new WeakMap<Model, {
     propertyInstancesById: Map<number, ModelProperty> // propertyId → ModelProperty
     propertyNameToId: Map<string, number> // propertyName → propertyId
   }>()
   ```

2. **Add methods to track property instances:**
   - `_registerPropertyInstance(property: ModelProperty)`
   - `_getPropertyInstances(): Map<number, ModelProperty>`

### Phase 2: Model Reads from ModelProperty Instances for Persistence

**File: `src/Model/Model.ts`**

1. **Refactor `_buildPropertiesFromInstances()` method:**
   - Instead of reading from `context.properties`
   - Read from ModelProperty instances in `instanceState.propertyInstancesById`
   - Build the properties object from ModelProperty instance data

2. **Update `_saveDraftToDb()` to use property instances:**
   - Read from ModelProperty instances instead of Model's `properties` object
   - Build the database structure from ModelProperty instance data

### Phase 3: Model References Property Instances (Not Updates)

**File: `src/Model/service/actors/loadOrCreateModel.ts`**

1. **Refactor to reference ModelProperty instances:**
   - After loading properties from database
   - For each property, call `ModelProperty.create()` or `ModelProperty.getById()`
   - Store references in Model's instance state
   - Don't push data to ModelProperty instances

### Phase 4: ModelProperty Loads from Database First

**File: `src/ModelProperty/ModelProperty.ts`**

1. **Refactor `ModelProperty.create()` to load from database first:**
   - Query database FIRST using `propertyId` or `modelName + propertyName`
   - Load property data from database tables
   - Only check Model context as absolute last resort if database doesn't have the property

## Benefits of This Refactoring

1. **Eliminates Update Loops**: No more circular updates between Model and ModelProperty
2. **Clearer Ownership**: ModelProperty instances own their edit state; Model is read-only reference
3. **Simpler Logic**: No need for complex loop prevention guards
4. **Better Performance**: Fewer unnecessary updates and validations
5. **Easier to Reason About**: Clear unidirectional flow: ModelProperty edits → ModelProperty validation → Schema validation (read-only)

## Migration Considerations

1. **Initial Load from JSON File**:
   - Generate `modelFileId` if missing
   - For each property, generate property ID if missing
   - Call `ModelProperty.create()` with property data
   - ModelProperty instances will load their data from database
   - Link everything via IDs in database

2. **Initial Load from Database**:
   - Query model record to get `modelFileId`
   - Query `properties` table to get property IDs
   - Call `ModelProperty.getById()` or `ModelProperty.create()` with property IDs
   - Don't care about ModelProperty instance state - they load their own data

3. **Reload**: When Model is reloaded, it should:
   - Get fresh property IDs from database
   - Reference ModelProperty instances by ID
   - **Never update ModelProperty instances** - they are independent

4. **Backward Compatibility**: Existing code that expects Model's `properties` to reflect ModelProperty edits will need to be updated to read from ModelProperty instances instead

