import { Static } from '@sinclair/typebox'
import { TProperty } from '@/Schema'
// Dynamic import to break circular dependency: Model -> ... -> helpers/property -> Model
// import { Model } from '@/Model/Model'
import pluralize from 'pluralize'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties, PropertyType } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'
import { modelPropertiesToObject } from '@/helpers/model'

// Re-export everything from property/index.ts to make it available when importing from helpers/property
export * from './property/index'

/**
 * Gets the propertyRecordSchema object for a given model and property name.
 * 
 * The propertyRecordSchema is the property definition object that contains
 * information about the property's data type, storage configuration, and
 * relationship details (for Relation and List types).
 * 
 * This function first checks the database for property definitions (which may
 * have been edited), then falls back to schema files. This ensures that
 * edited properties persist across page reloads.
 * 
 * This function handles property names that end with 'Id' or 'Ids' by automatically
 * looking up the base property name in the schema (e.g., 'authorId' -> 'author',
 * 'tagIds' -> 'tags').
 * 
 * @param modelName - The name of the model (e.g., 'Article', 'Author')
 * @param propertyName - The name of the property (e.g., 'title', 'author', 'authorId', 'tags', 'tagIds')
 * @returns The propertyRecordSchema object (TProperty with optional _propertyFileId) or undefined if not found
 * 
 * @example
 * ```typescript
 * const schema = await getPropertySchema('Article', 'title')
 * // Returns: { dataType: 'Text', ... }
 * 
 * const relationSchema = await getPropertySchema('Article', 'author')
 * // Returns: { dataType: 'Relation', ref: 'Author', ... }
 * 
 * // Also works with Id/Ids suffixes
 * const relationSchemaById = await getPropertySchema('Article', 'authorId')
 * // Returns: { dataType: 'Relation', ref: 'Author', ... }
 * ```
 */
export const getPropertySchema = async (
  modelName: string,
  propertyName: string,
): Promise<(Static<typeof TProperty> & { _propertyFileId?: string }) | undefined> => {
  // Dynamic import to break circular dependency
  const { Model } = await import('../Model/Model')
  const { Schema } = await import('../Schema/Schema')
  const model = await Model.getByNameAsync(modelName)

  console.log('getPropertySchema model', model)
  if (!model) {
    return undefined
  }
  
  // Get the original schema from Schema instance context (has ref fields from schema file)
  // This is more reliable than modelPropertiesToObject which depends on ModelProperty instances
  let schema: { [propertyName: string]: any } = {}
  try {
    const schemaName = model.schemaName
    if (schemaName) {
      const schemaInstance = Schema.create(schemaName, {
        waitForReady: false,
      }) as import('@/Schema/Schema').Schema
      const schemaContext = schemaInstance.getService().getSnapshot().context
      console.log('getPropertySchema schemaContext.models keys:', schemaContext.models ? Object.keys(schemaContext.models) : 'no models')
      if (schemaContext.models && schemaContext.models[modelName]) {
        // Get properties from Schema context (original schema file data)
        const modelDef = schemaContext.models[modelName]
        console.log('getPropertySchema modelDef for', modelName, ':', JSON.stringify(modelDef, null, 2))
        schema = modelDef.properties || {}
        console.log('getPropertySchema schema from Schema context', JSON.stringify(schema, null, 2))
      } else {
        console.log('getPropertySchema: model', modelName, 'not found in schemaContext.models')
      }
    }
  } catch (error) {
    console.log('getPropertySchema: Error getting schema from Schema instance, falling back to modelPropertiesToObject:', error)
  }
  
  // Fallback to modelPropertiesToObject if Schema context doesn't have the data
  if (Object.keys(schema).length === 0) {
    const properties = model.properties || []
    console.log('getPropertySchema properties', properties)
    if (properties.length === 0) {
      return undefined
    }
    schema = modelPropertiesToObject(properties)
    console.log('getPropertySchema schema from modelPropertiesToObject', schema)
  }
  
  // Helper to resolve property name (handles Id/Ids suffixes)
  const resolvePropertyName = (propName: string): string | undefined => {
    // First, try direct lookup
    if (schema[propName]) {
      return propName
    }
    
    // Handle properties ending with 'Id' or 'Ids'
    let propertyNameWithoutId: string | undefined
    
    if (propName.endsWith('Id')) {
      propertyNameWithoutId = propName.slice(0, -2)
    } else if (propName.endsWith('Ids')) {
      propertyNameWithoutId = propName.slice(0, -3)
      propertyNameWithoutId = pluralize(propertyNameWithoutId)
    }
    
    if (propertyNameWithoutId && schema[propertyNameWithoutId]) {
      return propertyNameWithoutId
    }
    
    return undefined
  }
  
  const resolvedPropertyName = resolvePropertyName(propertyName)
  console.log('resolvedPropertyName', resolvedPropertyName)
  if (!resolvedPropertyName) {
    return undefined
  }
  
  // Try to get property from database first (may have edited values)
  try {
    const db = BaseDb.getAppDb()
    if (db) {
      // Find the model in the database
      const modelRecords = await db
        .select()
        .from(modelsTable)
        .where(eq(modelsTable.name, modelName))
        .limit(1)
      
      if (modelRecords.length > 0) {
        const modelRecord = modelRecords[0]
        
        // Find the property in the database by name
        let propertyRecords = await db
          .select()
          .from(properties)
          .where(
            and(
              eq(properties.name, resolvedPropertyName),
              eq(properties.modelId, modelRecord.id!),
            ),
          )
          .limit(1)
        
        // If not found by name, check for renamed properties (orphaned DB properties)
        if (propertyRecords.length === 0) {
          // Get all properties for this model
          const allDbProperties = await db
            .select()
            .from(properties)
            .where(eq(properties.modelId, modelRecord.id!))
          
          // Get all schema property names to identify orphaned properties
          const schemaPropertyNames = new Set(Object.keys(schema))
          
          // Get the schema property definition to match characteristics
          const schemaPropertyDef = schema[resolvedPropertyName]
          
          if (schemaPropertyDef) {
            // Find orphaned properties (don't match any schema property name) that match characteristics
            const orphanedProperties = allDbProperties.filter((p: PropertyType) => 
              !schemaPropertyNames.has(p.name) && // Doesn't match any schema property name
              p.dataType === schemaPropertyDef.dataType // Same dataType
            )
            
            // If there's exactly one orphaned property with matching characteristics, it's likely the renamed property
            // We can also match by refModelId if it's a relation
            if (orphanedProperties.length > 0) {
              let matchedProperty = orphanedProperties[0]
              
              // If it's a relation, try to match by refModelId
              if (schemaPropertyDef.ref) {
                const refModelRecords = await db
                  .select()
                  .from(modelsTable)
                  .where(eq(modelsTable.name, schemaPropertyDef.ref))
                  .limit(1)
                
                if (refModelRecords.length > 0) {
                  const expectedRefModelId = refModelRecords[0].id
                  const matchingByRef = orphanedProperties.find((p: PropertyType) => p.refModelId === expectedRefModelId)
                  if (matchingByRef) {
                    matchedProperty = matchingByRef
                  }
                }
              } else {
                // For non-relation properties, prefer ones without refModelId
                const withoutRef = orphanedProperties.find((p: PropertyType) => p.refModelId === null)
                if (withoutRef) {
                  matchedProperty = withoutRef
                }
              }
              
              propertyRecords = [matchedProperty]
            }
          }
        }
        
        if (propertyRecords.length > 0) {
          const propertyRecord = propertyRecords[0]
          
          // Get the base schema from file to merge with database values
          // Use the schema object created earlier, not model.schema (which doesn't exist)
          const schemaFromFile = schema[resolvedPropertyName]
          
          // Build property schema from database, merging with file schema for fields not in DB
          // Use the schema property name (resolvedPropertyName) even if DB has different name (renamed)
          const propertySchema: Static<typeof TProperty> & { _propertyFileId?: string; _dbId?: number } = {
            ...schemaFromFile, // Start with file schema (has all fields like storageType, etc.)
            id: propertyRecord.schemaFileId || propertyRecord.id?.toString(), // id should be schemaFileId (string), not database ID
            _dbId: propertyRecord.id, // Store database integer ID separately
            name: resolvedPropertyName, // Use schema name, not DB name (for renamed properties)
            dataType: propertyRecord.dataType as any,
            modelId: propertyRecord.modelId,
            modelName,
            refModelId: propertyRecord.refModelId || undefined,
            refValueType: (propertyRecord.refValueType as any) || undefined,
            // Include schemaFileId from database as _propertyFileId for ModelProperty.create()
            _propertyFileId: propertyRecord.schemaFileId || undefined,
          }
          
          // If refModelId is set, try to get the refModelName
          if (propertyRecord.refModelId) {
            const refModelRecords = await db
              .select()
              .from(modelsTable)
              .where(eq(modelsTable.id, propertyRecord.refModelId))
              .limit(1)
            
            if (refModelRecords.length > 0) {
              propertySchema.refModelName = refModelRecords[0].name
              propertySchema.ref = refModelRecords[0].name
            }
          } else if (schemaFromFile?.ref) {
            // If refModelId is not set but schema file has ref, resolve it from the database
            // This handles cases where the property was just created and refModelId hasn't been set yet
            propertySchema.ref = schemaFromFile.ref
            propertySchema.refModelName = schemaFromFile.ref
            
            // Try to resolve refModelId from the database using the model name
            try {
              const refModelRecords = await db
                .select()
                .from(modelsTable)
                .where(eq(modelsTable.name, schemaFromFile.ref))
                .limit(1)
              
              if (refModelRecords.length > 0 && refModelRecords[0].id) {
                propertySchema.refModelId = refModelRecords[0].id
              }
            } catch (error) {
              // Ignore errors - model might not exist yet
            }
          }
          
          console.log(`[getPropertySchema] Returning propertySchema for ${modelName}:${resolvedPropertyName}:`, {
            ref: propertySchema.ref,
            refModelName: propertySchema.refModelName,
            refModelId: propertySchema.refModelId,
            dataType: propertySchema.dataType,
            schemaFromFileRef: schemaFromFile?.ref,
            propertyRecordRefModelId: propertyRecord.refModelId
          })
          
          return propertySchema
        }
      }
    }
  } catch (error) {
    // Database not available or error - fall through to schema file lookup
  }
  
  // Fall back to schema file lookup
  const schemaFromFile = schema[resolvedPropertyName]
  if (schemaFromFile) {
    const propertySchema: Static<typeof TProperty> & { _propertyFileId?: string } = { ...schemaFromFile, name: resolvedPropertyName }
    
    // If schema file has id as a string (propertyFileId), set it as _propertyFileId
    // This handles cases where the property hasn't been saved to the database yet
    if (typeof schemaFromFile.id === 'string') {
      propertySchema._propertyFileId = schemaFromFile.id
    }
    
    // If the schema file has ref but no refModelId, try to resolve it from the database
    if (schemaFromFile.ref && !propertySchema.refModelId) {
      try {
        const db = BaseDb.getAppDb()
        if (db) {
          const refModelRecords = await db
            .select()
            .from(modelsTable)
            .where(eq(modelsTable.name, schemaFromFile.ref))
            .limit(1)
          
          if (refModelRecords.length > 0 && refModelRecords[0].id) {
            propertySchema.refModelId = refModelRecords[0].id
            propertySchema.refModelName = schemaFromFile.ref
          }
        }
      } catch (error) {
        // Ignore errors - model might not exist yet or database not available
      }
    }
    
    return propertySchema
  }
  return undefined
}
