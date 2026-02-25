# Schema Update Strategy

## Overview

This document outlines the strategy for updating model properties in schemas, including how changes are handled in both the JSON file system and the Drizzle database.

## Architecture

### File System Storage
- Schemas are stored as JSON files in the `workingDir` with format: `{name}-v{version}.json`
- Each schema version is immutable - updates create new versions
- Only the latest version of each schema is loaded on SDK initialization

### Database Storage
- `schemas` table: Stores schema metadata (name, version, timestamps)
- `models` table: Stores model definitions (id, name)
- `properties` table: Stores property definitions (id, name, data_type, model_id, ref_model_id, ref_value_type)
- `model_schemas` table: Join table linking models to schemas

## Update Flow

### 1. Property Updates (Type Changes, Configuration Changes)

**Example**: Changing a property from `Relation` to `Image`

**File System**:
1. Load latest schema version
2. Update property definition in memory
3. Create new schema version (increment version number)
4. Write new JSON file
5. Load new schema file (which updates database)

**Database Strategy**: **UPDATE IN PLACE**
- The `createOrUpdate` function in `addModelsToDb` will:
  - Match existing property by `name` + `modelId` (unique constraint)
  - Update the `dataType` field
  - Update `refModelId` if it changed (set to null for non-Relation types)
  - Update `refValueType` if applicable

**Rationale**: 
- Properties are identified by name + model, so updating in place maintains referential integrity
- Existing metadata records continue to reference the same property
- No data loss or orphaned records

### 2. Property Renames

**Example**: Renaming `featureImage` to `coverImage`

**File System**:
1. Load latest schema version
2. Create new property with new name
3. Copy all property configuration
4. Delete old property
5. Create new schema version

**Database Strategy**: **CREATE NEW + HANDLE OLD**
- New property record is created with new name
- Old property record remains in database (for historical data)
- **Recommendation**: Add a migration script to:
  - Copy metadata from old property to new property
  - Or mark old property as deprecated
  - Or delete old property if no metadata references it

**Rationale**:
- Property names are part of the unique key, so we can't update in place
- Historical metadata may reference the old property name
- Need explicit migration to handle data migration

### 3. Model Renames

**Example**: Renaming `Post` to `Article`

**File System**:
1. Load latest schema version
2. Rename model in models object
3. Update all property references (Relation properties that reference this model)
4. Create new schema version

**Database Strategy**: **UPDATE IN PLACE**
- Update the `name` field in the `models` table
- Update all `properties.refModelId` references to point to the renamed model
- Update `model_schemas` join records (they reference by ID, so no change needed)

**Rationale**:
- Models are identified by name, but we can update the name
- Foreign key relationships use IDs, so they remain valid
- All properties that reference this model via `refModelId` continue to work

## Current Implementation

### Database Update Logic

The `addModelsToDb` function uses `createOrUpdate` which:
1. Searches for existing records matching the provided fields
2. If found, updates the record
3. If not found, creates a new record

**For Properties**:
- Matches on `name` + `modelId` (unique constraint)
- Updates `dataType`, `refModelId`, `refValueType` if they changed

**For Models**:
- Matches on `name`
- Currently only creates, doesn't update name (this needs to be fixed for renames)

## Recommendations

### 1. Model Rename Handling

**Option A: Update in Place (Recommended)**
- Update model name in database
- All foreign key relationships remain valid (they use IDs)
- Properties that reference the model continue to work
- **Implementation**: Modify `addModelsToDb` to handle model renames

**Option B: Delete and Recreate**
- Delete all models for a schema
- Recreate them with new names
- **Problem**: This breaks foreign key relationships and loses historical data
- **Not Recommended**

### 2. Property Rename Handling

**Recommended Approach**:
1. Create new property with new name
2. Provide migration utility to copy metadata from old to new property
3. Optionally mark old property as deprecated
4. Keep old property for historical reference

### 3. Schema Versioning

- Each schema update creates a new version file
- Only latest version is loaded on initialization
- Old versions remain for historical reference
- Migration history is tracked in the `migrations` array

## Implementation Status

✅ **Completed**:
- `updateModelProperties()` - Updates properties and creates new schema version
- `renameModelProperty()` - Renames properties
- `deletePropertyFromModel()` - Deletes properties from models
- `deleteModelFromSchema()` - Deletes models from schemas with options for handling references
- `listLatestSchemaFiles()` - Gets only latest versions
- `processSchemaFiles()` - Updated to load only latest versions
- Model rename handling in database

⚠️ **Needs Enhancement**:
- Property rename migration utilities
- Better handling of orphaned properties after renames
- Database cleanup utilities for deleted models/properties

## Usage Examples

### Update Property Type
```typescript
import { updateModelProperties } from '@/helpers/updateSchema'

await updateModelProperties('blog-schema', [
  {
    modelName: 'Post',
    propertyName: 'featureImage',
    updates: {
      type: 'Image', // Changed from 'Relation'
      // Remove model reference since it's no longer a Relation
    }
  }
])
```

### Rename Property
```typescript
import { renameModelProperty } from '@/helpers/updateSchema'

await renameModelProperty('blog-schema', 'Post', 'featureImage', 'coverImage')
```

### Rename Model
```typescript
import { updateModelProperties } from '@/helpers/updateSchema'

await updateModelProperties('blog-schema', [], [
  {
    oldName: 'Post',
    newName: 'Article'
  }
])
```

### Delete Property
```typescript
import { deletePropertyFromModel } from '@/helpers/updateSchema'

await deletePropertyFromModel('blog-schema', 'Post', 'featureImage')
```

### Delete Model
```typescript
import { deleteModelFromSchema } from '@/helpers/updateSchema'

// Delete model and remove all properties that reference it
await deleteModelFromSchema('blog-schema', 'Image', {
  removeReferencingProperties: true
})

// Delete model but keep properties (just remove model references)
await deleteModelFromSchema('blog-schema', 'Image', {
  removeReferencingProperties: false
})
```
