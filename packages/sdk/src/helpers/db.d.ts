import { NewModelRecord } from '@/seedSchema';
import { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { DbQueryResult, ModelDefinitions, ResultObject } from '@/types';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import { SchemaType, schemas } from '@/seedSchema/SchemaSchema';
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine';
export declare const escapeSqliteString: (value: string) => string;
export declare const getObjectForRow: (row: any) => ResultObject;
export declare const getSqlResultObject: (queryResult: DbQueryResult) => ResultObject | ResultObject[] | undefined;
export declare const createOrUpdate: <T>(db: BetterSQLite3Database | SqliteRemoteDatabase, table: SQLiteTableWithColumns<any>, values: Partial<Record<keyof T, T[keyof T]>>) => Promise<T>;
/**
 * Searches the database for an existing schema by schemaFileId (preferred) or name and creates it if it doesn't exist
 * @param schema - The schema to add to the database
 * @param schemaFileId - Optional schemaFileId from JSON file for change tracking
 * @param schemaData - Optional full schema content as JSON string (SchemaFileFormat)
 * @param isDraft - Optional flag indicating if schema is in draft state (default: false)
 * @param isEdited - Optional flag indicating if schema has been edited locally (default: false)
 * @returns The schema record (either existing or newly created)
 */
export declare const addSchemaToDb: (schema: Omit<SchemaType, "id" | "schemaFileId" | "schemaData" | "isDraft" | "isEdited">, schemaFileId?: string, schemaData?: string, isDraft?: boolean, isEdited?: boolean) => Promise<typeof schemas.$inferSelect>;
/**
 * Rename a model in the database
 * Updates the model name and all properties that reference it
 * @param oldName - The current model name
 * @param newName - The new model name
 * @param schemaNameOrId - Schema name or schema ID to scope the rename (required when multiple schemas have models with the same name)
 * @returns The updated model record
 */
export declare const renameModelInDb: (oldName: string, newName: string, schemaNameOrId?: string | number) => Promise<NewModelRecord>;
/**
 * Adds models and their properties to the database.
 * Optionally connects models to a schema via join records.
 * @param models - The model definitions to add
 * @param schema - Optional schema to connect models to
 * @param modelRenames - Optional map of old model names to new model names for handling renames
 * @param schemaFileData - Optional object containing schemaFileId mappings from JSON file: { schemaFileId, modelFileIds: Map<modelName, id>, propertyFileIds: Map<modelName, Map<propertyName, id>> }
 */
export declare const addModelsToDb: (models: ModelDefinitions, schema?: SchemaType, modelRenames?: Map<string, string>, schemaFileData?: {
    schemaFileId?: string;
    modelFileIds?: Map<string, string>;
    propertyFileIds?: Map<string, Map<string, string>>;
}) => Promise<void>;
/**
 * Loads models from the database for a given schema by querying the model_schemas join table.
 * This ensures that models added to the database (via model_schemas) are included even if
 * they're not in the schemaData JSON.
 * @param schemaId - The ID of the schema record in the database
 * @returns A map of model names to model data (compatible with SchemaFileFormat.models)
 */
export declare const loadModelsFromDbForSchema: (schemaId: number) => Promise<{
    [modelName: string]: any;
}>;
/**
 * Returns model name by database model ID.
 */
export declare function getModelNameByModelId(modelId: number): Promise<string | undefined>;
/**
 * Resolves modelName and dataType for a property by its schemaFileId (e.g. context.id).
 * Used when machine context lacks these (e.g. just-created property renamed before full context is set).
 */
export declare function getPropertyModelNameAndDataType(schemaFileId: string): Promise<{
    modelName: string;
    dataType: string;
} | undefined>;
/**
 * Saves a property's changes to the database without updating the JSON schema file.
 * This is used when properties are edited but the schema hasn't been saved as a new version yet.
 * @param property - The ModelPropertyMachineContext with updated values
 */
export declare const savePropertyToDb: (property: ModelPropertyMachineContext) => Promise<void>;
export declare const getOwnedAddressesFromDb: () => Promise<string[]>;
export declare const getWatchedAddressesFromDb: () => Promise<string[]>;
/**
 * Returns owned + watched addresses. Use for EAS sync and file download.
 */
export declare const getAllAddressesFromDb: () => Promise<string[]>;
export declare const getAddressesFromDb: () => Promise<string[]>;
/**
 * Like getAddressesFromDb but returns [] instead of throwing when no addresses are configured.
 * Returns owned addresses. Use getAllAddressesFromDb for sync (owned + watched).
 */
export declare const getAddressesFromDbOptional: () => Promise<string[]>;
/**
 * Write model to database and create model_schemas join entry
 * @param modelFileId - The model file ID (schema_file_id)
 * @param data - Model data including modelName, schemaId, and optional properties
 */
export declare function writeModelToDb(modelFileId: string, data: {
    modelName: string;
    schemaId: number;
    properties?: {
        [name: string]: any;
    };
}): Promise<void>;
/**
 * Write property to database
 * @param propertyFileId - The property file ID (schema_file_id)
 * @param data - Property data including modelId, name, dataType, and other property fields
 * @param isEdited - Optional flag indicating if property has been edited locally (default: false)
 */
export declare function writePropertyToDb(propertyFileId: string, data: {
    modelId: number;
    name: string;
    dataType: string;
    refModelName?: string;
    refModelId?: number;
    refValueType?: string;
    storageType?: string;
    localStorageDir?: string;
    filenameSuffix?: string;
    [key: string]: any;
}, isEdited?: boolean): Promise<void>;
/**
 * Get schema database ID from schema name or schemaFileId
 * @param schemaNameOrFileId - Schema name (string) or schemaFileId (string)
 * @returns Schema database ID
 * @throws Error if schema not found
 */
export declare function getSchemaId(schemaNameOrFileId: string): Promise<number>;
/**
 * Get schema database ID from schemaFileId
 * @param schemaFileId - The schema file ID
 * @returns Schema database ID
 * @throws Error if schema not found
 */
export declare function getSchemaIdByFileId(schemaFileId: string): Promise<number>;
/**
 * Get model database ID from model name or modelFileId
 * @param modelNameOrFileId - Model name (string) or modelFileId (string)
 * @param schemaNameOrId - Optional schema name or ID to narrow search
 * @returns Model database ID
 * @throws Error if model not found
 */
export declare function getModelId(modelNameOrFileId: string, schemaNameOrId?: string | number): Promise<number>;
/**
 * Get model database ID from modelFileId
 * @param modelFileId - The model file ID (schema_file_id)
 * @returns Model database ID
 * @throws Error if model not found
 */
export declare function getModelIdByFileId(modelFileId: string): Promise<number>;
//# sourceMappingURL=db.d.ts.map