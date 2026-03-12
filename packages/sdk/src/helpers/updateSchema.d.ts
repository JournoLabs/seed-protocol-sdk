import { SchemaFileFormat } from '@/types/import';
import { Static } from '@sinclair/typebox';
import { TProperty } from '@/Schema';
/**
 * Schema property update definition
 */
export type SchemaPropertyUpdate = {
    modelName: string;
    propertyName: string;
    updates: {
        type?: string;
        model?: string;
        refValueType?: string;
        ref?: string;
        storage?: {
            type: string;
            path?: string;
            extension?: string;
        };
        required?: boolean;
        description?: string;
        validation?: {
            pattern?: string;
            [key: string]: any;
        };
        [key: string]: any;
    };
};
/**
 * Schema model update definition (for renaming models)
 */
export type SchemaModelUpdate = {
    oldName: string;
    newName: string;
};
/**
 * Options for deletion operations
 */
export type DeleteOptions = {
    /**
     * If true, also remove properties that reference the deleted model
     * If false, properties referencing the model will have their refModelId set to null
     * Default: false
     */
    removeReferencingProperties?: boolean;
    /**
     * If true, also delete from database (not just remove from schema)
     * If false, keep in database for historical data
     * Default: false
     */
    deleteFromDatabase?: boolean;
};
/**
 * Find the property name in a schema file by its schemaFileId (property id).
 * Used when _originalValues may not be set (e.g., newly created property renamed quickly).
 * First looks up in the schema file; if not found, falls back to the database.
 * @param schemaName - Schema name
 * @param modelName - Model name
 * @param propertySchemaFileId - The property's id from the schema file
 * @returns The property name as it appears in the schema, or undefined if not found
 */
export declare function findPropertyNameBySchemaFileId(schemaName: string, modelName: string, propertySchemaFileId: string): Promise<string | undefined>;
/**
 * Write the full schema to a new version file (e.g. when new models were added).
 * Used when _editedProperties contains 'schema:models' and there are no property-level updates.
 * @param schemaName - Schema name
 * @param schema - Full schema object (e.g. from _buildModelsFromInstances)
 * @returns The file path of the new schema version
 */
export declare function writeFullSchemaNewVersion(schemaName: string, schema: SchemaFileFormat): Promise<string>;
/**
 * Get model name from modelId
 * @param modelId - The model ID to look up
 * @returns The model name, or undefined if not found
 */
export declare function getModelNameFromId(modelId: number | undefined): Promise<string | undefined>;
/**
 * Convert a TProperty/ModelPropertyMachineContext to SchemaPropertyUpdate format
 * This function converts the internal property representation to the schema file format
 * @param property - The TProperty instance to convert
 * @param modelName - The name of the model this property belongs to
 * @param propertyName - The name of the property
 * @returns A SchemaPropertyUpdate object ready to be passed to updateModelProperties
 */
export declare function convertPropertyToSchemaUpdate(property: Static<typeof TProperty>, modelName: string, propertyName: string): Promise<SchemaPropertyUpdate>;
/**
 * Update model properties in a schema and create a new version
 * @param schemaName - The name of the schema to update
 * @param propertyUpdates - Array of property updates to apply
 * @param modelUpdates - Optional array of model renames
 * @returns The file path of the new schema version
 * @throws Error if schema not found or updates are invalid
 */
export declare function updateModelProperties(schemaName: string, propertyUpdates: SchemaPropertyUpdate[], modelUpdates?: SchemaModelUpdate[]): Promise<string>;
/**
 * Rename a property in a model
 * This is a convenience function that updates the property name
 * Note: This creates a new property and you may want to handle the old property separately
 * @param schemaName - The name of the schema
 * @param modelName - The name of the model
 * @param oldPropertyName - The current property name
 * @param newPropertyName - The new property name
 * @returns The file path of the new schema version
 */
export declare function renameModelProperty(schemaName: string, modelName: string, oldPropertyName: string, newPropertyName: string): Promise<string>;
/**
 * Delete a model from a schema
 * @param schemaName - The name of the schema
 * @param modelName - The name of the model to delete
 * @param options - Optional deletion options
 * @returns The file path of the new schema version
 * @throws Error if schema or model not found
 */
export declare function deleteModelFromSchema(schemaName: string, modelName: string, options?: DeleteOptions): Promise<string>;
/**
 * Delete a property from a model in a schema
 * @param schemaName - The name of the schema
 * @param modelName - The name of the model
 * @param propertyName - The name of the property to delete
 * @param options - Optional deletion options
 * @returns The file path of the new schema version
 * @throws Error if schema, model, or property not found
 */
export declare function deletePropertyFromModel(schemaName: string, modelName: string, propertyName: string, options?: DeleteOptions): Promise<string>;
//# sourceMappingURL=updateSchema.d.ts.map