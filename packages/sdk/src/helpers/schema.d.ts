import { Model } from '@/Model/Model';
import { SchemaFileFormat } from '@/types/import';
/**
 *
 * Schema type definition
 * A Schema is a collection of Models with a name and version
 */
export type Schema = {
    id?: string;
    name?: string;
    metadata?: {
        name: string;
        createdAt: string;
        updatedAt: string;
    };
    version: number;
    models: Model[];
};
/**
 * Create a new schema file
 * @param schema - The schema object to save
 * @param schemaFileId - Schema file ID (required)
 * @throws Error if schema already exists or if workingDir is invalid
 */
export declare const createSchema: (schema: Schema, schemaFileId: string) => Promise<void>;
/**
 * Read a schema file by name and version
 * @param name - The name of the schema
 * @param version - The version of the schema
 * @param schemaFileId - Schema file ID (required)
 * @returns The schema object, or null if not found
 */
export declare const readSchema: (name: string, version: number, schemaFileId: string) => Promise<Schema | null>;
/**
 * Update an existing schema file
 * @param schema - The updated schema object (must have same name and version as existing)
 * @param schemaFileId - Schema file ID (required)
 * @throws Error if schema doesn't exist
 */
export declare function updateSchema(schema: Schema, schemaFileId: string): Promise<void>;
/**
 * Delete a schema file
 * @param name - The name of the schema
 * @param version - The version of the schema
 * @param schemaFileId - Schema file ID (required)
 * @throws Error if schema doesn't exist
 */
export declare function deleteSchema(name: string, version: number, schemaFileId: string): Promise<void>;
/**
 * List all schema files in the working directory
 * Only returns files that are NOT already complete schema files (i.e., files without $schema field)
 * This allows processing of minimal import files while skipping already-processed schema files
 * @returns Array of objects containing name, version, and file path for each schema
 */
export declare function listSchemaFiles(): Promise<Array<{
    name: string;
    version: number;
    filePath: string;
}>>;
/**
 * List all complete schema files in the working directory
 * Only returns files that are complete schema files (i.e., files with $schema field)
 * These are already-processed schema files that need to be loaded into the model store
 * @returns Array of objects containing name, version, and file path for each complete schema
 */
export declare function listCompleteSchemaFiles(): Promise<Array<{
    name: string;
    version: number;
    filePath: string;
    schemaFileId?: string;
}>>;
/**
 * Find a schema by name (returns the latest version if multiple versions exist)
 * @param name - The name of the schema
 * @returns The schema with the highest version, or null if not found
 */
export declare function findSchemaByName(name: string): Promise<Schema | null>;
/**
 * Get the latest version number for a schema by name
 * Only considers complete schema files (with $schema field)
 * @param name - The name of the schema
 * @returns The latest version number, or 0 if no schema found
 */
export declare function getLatestSchemaVersion(name: string): Promise<number>;
/**
 * Get only the latest version of each schema
 * @returns Array of objects containing name, version, and file path for the latest version of each schema
 */
export declare function listLatestSchemaFiles(): Promise<Array<{
    name: string;
    version: number;
    filePath: string;
}>>;
/**
 * Filter an array of schemas to only include the latest version for each schema name
 * Works with any object that has a name (via metadata.name or name property) and a version property
 * @param schemas - Array of schema objects
 * @returns Array containing only the latest version of each schema
 */
export declare function filterLatestSchemas<T extends {
    name?: string;
    metadata?: {
        name: string;
    };
    version: number;
}>(schemas: T[]): T[];
/**
 * Unified schema loading function that queries database first, then merges with files
 * Returns all schemas with their draft status and source information
 * @returns Array of schema objects with metadata about their state
 */
export declare function loadAllSchemasFromDb(): Promise<Array<{
    schema: SchemaFileFormat;
    isDraft: boolean;
    source: 'db' | 'file' | 'db+file';
    schemaRecordId?: number;
}>>;
/**
 * Migration helper: Migrate existing file-based schemas to the database
 * This function should be called once to migrate existing schema files to the new database-first approach
 * All existing schemas will be marked as published (isDraft = false) since they already exist in files
 * @returns Number of schemas migrated
 */
export declare function migrateFileSchemasToDb(): Promise<number>;
/**
 * Extract the schema name from a schemaId string
 * @param schemaId - Schema ID in the format `${schemaName}-${schemaVersion}`
 * @returns The schema name, or null if the format is invalid
 */
export declare function getSchemaNameFromId(schemaId: string | null | undefined): string | null;
//# sourceMappingURL=schema.d.ts.map