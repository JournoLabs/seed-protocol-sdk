import { Static } from '@sinclair/typebox';
import { TProperty } from '@/Schema';
export * from './property/index';
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
export declare const getPropertySchema: (modelName: string, propertyName: string) => Promise<(Static<typeof TProperty> & {
    _propertyFileId?: string;
}) | undefined>;
//# sourceMappingURL=property.d.ts.map