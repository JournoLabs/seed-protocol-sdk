# Schema Update Implementation Summary

## Overview

This document summarizes the implementation of schema update functionality, allowing you to update model properties, rename properties, and rename models while maintaining version history.

## What Was Implemented

### 1. Core Update Functions (`src/helpers/updateSchema.ts`)

#### `updateModelProperties()`
Updates one or more properties in a schema and creates a new version.

**Features**:
- Loads the latest schema version
- Applies property updates (type changes, configuration changes)
- Handles model renames
- Creates new schema version with incremented version number
- Tracks changes in migrations array
- Automatically loads the new schema into the database

**Example**:
```typescript
import { updateModelProperties } from '@/helpers/updateSchema'

// Change property type from Relation to Image
await updateModelProperties('blog-schema', [
  {
    modelName: 'Post',
    propertyName: 'featureImage',
    updates: {
      type: 'Image', // Changed from 'Relation'
    }
  }
])
```

#### `renameModelProperty()`
Renames a property in a model.

**Features**:
- Creates new property with new name
- Copies all property configuration
- Removes old property
- Creates new schema version
- Tracks rename in migrations

**Example**:
```typescript
import { renameModelProperty } from '@/helpers/updateSchema'

await renameModelProperty('blog-schema', 'Post', 'featureImage', 'coverImage')
```

#### `deletePropertyFromModel()`
Deletes a property from a model in a schema.

**Features**:
- Removes property from model definition
- Creates new schema version
- Tracks deletion in migrations
- Property remains in database for historical data

**Example**:
```typescript
import { deletePropertyFromModel } from '@/helpers/updateSchema'

await deletePropertyFromModel('blog-schema', 'Post', 'featureImage')
```

#### `deleteModelFromSchema()`
Deletes a model from a schema.

**Features**:
- Removes model from schema definition
- Handles properties that reference the deleted model
- Option to remove referencing properties or just remove references
- Prevents deletion if it's the only model in the schema
- Creates new schema version
- Tracks deletion in migrations
- Model remains in database for historical data

**Options**:
- `removeReferencingProperties`: If `true`, removes all properties that reference the deleted model. If `false`, just removes the model reference from those properties.

**Example**:
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

### 2. Schema Helper Functions (`src/helpers/schema.ts`)

#### `getLatestSchemaVersion()`
Gets the latest version number for a schema by name.

#### `listLatestSchemaFiles()`
Returns only the latest version of each schema (filters out older versions).

### 3. Database Update Functions (`src/helpers/db.ts`)

#### `renameModelInDb()`
Handles model renames in the database.

**Strategy**: Updates model name in place, preserving all foreign key relationships.

#### Enhanced `addModelsToDb()`
Now accepts optional `modelRenames` parameter to handle model renames during schema loading.

### 4. Updated Schema Loading (`src/client/actors/processSchemaFiles.ts`)

**Change**: Now only loads the latest version of each schema on SDK initialization.

**Before**: Loaded all schema versions
**After**: Only loads latest versions using `listLatestSchemaFiles()`

## Database Update Strategy

### Property Type Changes (e.g., Relation → Image)

**Strategy**: **UPDATE IN PLACE**

- Properties are matched by `name` + `modelId` (unique constraint)
- `dataType` field is updated
- `refModelId` is updated (set to null for non-Relation types)
- Existing metadata records continue to reference the same property
- No data loss

### Property Renames

**Strategy**: **CREATE NEW + KEEP OLD**

- New property record is created with new name
- Old property record remains in database (for historical data)
- **Note**: You may want to create a migration script to copy metadata from old to new property

### Model Renames

**Strategy**: **UPDATE IN PLACE** (Recommended)

- Model name is updated in the `models` table
- All foreign key relationships remain valid (they use IDs, not names)
- Properties that reference the model via `refModelId` continue to work
- No data loss or broken relationships

**Alternative**: Delete and recreate (NOT recommended - breaks relationships and loses data)

### Model Deletions

**Strategy**: **REMOVE FROM SCHEMA + KEEP IN DB**

- Model is removed from schema definition
- Model record remains in database (for historical data)
- Properties that reference the model can be:
  - Removed entirely (if `removeReferencingProperties: true`)
  - Updated to remove model reference (if `removeReferencingProperties: false`)
- Prevents deletion if it's the only model in the schema

### Property Deletions

**Strategy**: **REMOVE FROM SCHEMA + KEEP IN DB**

- Property is removed from model definition
- Property record remains in database (for historical data)
- Existing metadata records that reference the property remain intact

## File System Behavior

### Versioning
- Each update creates a new JSON file: `{name}-v{version}.json`
- Old versions are preserved for historical reference
- Only latest version is loaded on initialization

### Migration Tracking
- Each schema file contains a `migrations` array
- Each migration records:
  - Version number
  - Timestamp
  - Description
  - List of changes (property updates, renames, etc.)

## Usage Examples

### Example 1: Change Property Type
```typescript
import { updateModelProperties } from '@/helpers/updateSchema'

// Change a Relation property to Image
await updateModelProperties('blog-schema', [
  {
    modelName: 'Post',
    propertyName: 'featureImage',
    updates: {
      type: 'Image',
      // Remove model reference since it's no longer a Relation
    }
  }
])
```

### Example 2: Rename Property
```typescript
import { renameModelProperty } from '@/helpers/updateSchema'

await renameModelProperty('blog-schema', 'Post', 'featureImage', 'coverImage')
```

### Example 3: Rename Model
```typescript
import { updateModelProperties } from '@/helpers/updateSchema'

await updateModelProperties('blog-schema', [], [
  {
    oldName: 'Post',
    newName: 'Article'
  }
])
```

### Example 4: Multiple Updates
```typescript
import { updateModelProperties } from '@/helpers/updateSchema'

await updateModelProperties('blog-schema', [
  {
    modelName: 'Post',
    propertyName: 'title',
    updates: {
      required: true,
      description: 'The post title (required)'
    }
  },
  {
    modelName: 'Post',
    propertyName: 'summary',
    updates: {
      type: 'Text',
      required: false
    }
  }
], [
  {
    oldName: 'Post',
    newName: 'Article'
  }
])
```

### Example 5: Delete Property
```typescript
import { deletePropertyFromModel } from '@/helpers/updateSchema'

await deletePropertyFromModel('blog-schema', 'Post', 'featureImage')
```

### Example 6: Delete Model
```typescript
import { deleteModelFromSchema } from '@/helpers/updateSchema'

// Delete model and remove properties that reference it
await deleteModelFromSchema('blog-schema', 'Image', {
  removeReferencingProperties: true
})

// Delete model but keep properties (just remove references)
await deleteModelFromSchema('blog-schema', 'Image', {
  removeReferencingProperties: false
})
```

## Recommendations

### 1. Model Renames: Update in Place ✅
**Recommended**: Update model names in the database
- Preserves all relationships
- No data loss
- Foreign keys remain valid

**Not Recommended**: Delete and recreate
- Breaks foreign key relationships
- Loses historical data
- Requires complex migration

### 2. Property Renames: Handle Migration
When renaming properties:
1. New property is created automatically
2. Consider creating a migration script to:
   - Copy metadata from old property to new property
   - Or mark old property as deprecated
   - Or delete old property if no metadata references it

### 3. Schema Versioning
- Always create new versions (never modify existing versions)
- Keep old versions for historical reference
- Only load latest versions on initialization

## Testing Recommendations

1. **Test property type changes**: Verify database updates correctly
2. **Test property renames**: Verify new property is created and old remains
3. **Test model renames**: Verify model name updates and relationships remain intact
4. **Test version loading**: Verify only latest versions are loaded
5. **Test migration tracking**: Verify changes are recorded in migrations array

## Future Enhancements

1. **Property Rename Migration Utility**: Helper function to migrate metadata from old to new property
2. **Schema Diff Utility**: Compare two schema versions to see what changed
3. **Rollback Functionality**: Ability to revert to a previous schema version
4. **Validation**: Check for breaking changes before applying updates
5. **Deprecation Markers**: Mark old properties/models as deprecated instead of deleting
