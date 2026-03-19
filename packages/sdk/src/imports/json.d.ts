import { JsonImportSchema, SchemaFileFormat } from '../types/import';
import { ModelDefinitions } from '@/types';
/**
 * Transform import JSON format to full schema file format
 * @param importData - The JSON import data
 * @param version - The version number for the schema (defaults to 1)
 * @returns The transformed schema file format
 */
export declare const transformImportToSchemaFile: (importData: JsonImportSchema, version?: number) => SchemaFileFormat;
/**
 * Parse JSON import content (string) into JsonImportSchema format
 * Supports two formats:
 * 1. Minimal format: { name: string, models: {...} }
 * 2. Complete schema format: { $schema: string, metadata: { name: string }, models: {...}, ... }
 * @param content - The JSON content as a string
 * @returns The parsed JSON import data normalized to JsonImportSchema format
 * @throws Error if content cannot be parsed
 */
export declare const parseJsonImportContent: (content: string) => JsonImportSchema;
/**
 * Read and parse a JSON import file
 * Supports two formats:
 * 1. Minimal format: { name: string, models: {...} }
 * 2. Complete schema format: { $schema: string, metadata: { name: string }, models: {...}, ... }
 * @param filePath - Path to the JSON import file
 * @returns The parsed JSON import data normalized to JsonImportSchema format
 * @throws Error if file cannot be read or parsed
 */
export declare const readJsonImportFile: (filePath: string) => Promise<JsonImportSchema>;
/**
 * Import a JSON schema file and save it in the full schema file format
 * Also converts the JSON models to Model classes and adds them to the database
 * @param importFilePath - Path to the JSON import file
 * @param version - The version number for the schema (defaults to 1)
 * @returns The file path where the schema was saved
 * @throws Error if import file cannot be read, parsed, or if schema already exists
 */
export declare function importJsonSchema(importFilePath: string, version?: number): Promise<string>;
/**
 * Import a JSON schema from file contents and save it in the full schema file format
 * Also converts the JSON models to Model classes and adds them to the database
 * @param importFileContents - Object containing the JSON file contents as a string
 * @param version - The version number for the schema (defaults to 1)
 * @returns The file path where the schema was saved
 * @throws Error if import content cannot be parsed, or if schema already exists
 */
export declare function importJsonSchema(importFileContents: {
    contents: string;
}, version?: number): Promise<string>;
/**
 * Load an existing complete schema file and process its models
 * This is used to load models from already-processed schema files into the store
 * @param schemaFilePath - Path to the complete schema file (must have $schema field)
 * @returns The file path of the schema
 * @throws Error if file cannot be read, parsed, or is not a complete schema
 */
export declare const loadSchemaFromFile: (schemaFilePath: string) => Promise<string>;
/**
 * Sync a canonical schema from a file path or inlined object to the database.
 * Uses add/update semantics: no "already exists with different content" errors, no ID-based file copy.
 * Called automatically at init when config.schema is provided.
 *
 * @param source - File path (string) or complete SchemaFileFormat object
 */
export declare function syncSchemaFromSource(source: string | SchemaFileFormat): Promise<void>;
/**
 * Create a Model class from a JSON model definition
 * @param modelName - The name of the model
 * @param modelDef - The JSON model definition
 * @param schemaName - The name of the schema this model belongs to
 * @returns A Model class that can be used with the SDK
 */
export declare const createModelFromJson: (modelName: string, modelDef: JsonImportSchema["models"][string], schemaName: string, modelFileId?: string, // Optional modelFileId from JSON file
propertyFileIds?: Map<string, string>) => Promise<any>;
/**
 * Convert JSON import schema to ModelDefinitions
 * @param importData - The JSON import data
 * @param modelFileIds - Optional map of model names to their file IDs from the JSON file
 * @param propertyFileIds - Optional map of model names to maps of property names to their file IDs from the JSON file
 * @returns ModelDefinitions object with Model classes
 */
export declare const createModelsFromJson: (importData: JsonImportSchema, modelFileIds?: Map<string, string>, propertyFileIds?: Map<string, Map<string, string>>) => Promise<ModelDefinitions>;
/**
 * Read a JSON import file and create Model classes from it
 * @param filePath - Path to the JSON import file
 * @returns ModelDefinitions with Model classes created from the JSON schema
 */
export declare const createModelsFromJsonFile: (filePath: string) => Promise<ModelDefinitions>;
//# sourceMappingURL=json.d.ts.map