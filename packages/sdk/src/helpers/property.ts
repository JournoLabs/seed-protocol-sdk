import { Static } from '@sinclair/typebox'
import { TProperty } from '@/Schema'
import pluralize from 'pluralize'
import { propertyKeyFromStoredName } from '@/helpers/metadataPropertyNames'
import { BaseDb } from '@/db/Db/BaseDb'
import type { ModelScope } from '@/db/read/resolveModelRecord'
import type { PropertyDefinition } from '@/helpers/propertyDefinition'

// Re-export everything from property/index.ts to make it available when importing from helpers/property
export * from './property/index'

/**
 * The key in `defs` a property name refers to: the key itself, a stored metadata name
 * (`authorId` → `author`, `authorIdentityIds` → `authors`), or the name minus `Id` / `Ids`
 * (pluralized).
 */
export function resolvePropertyKey(defs: Record<string, any>, propertyName: string): string | undefined {
  if (defs[propertyName]) return propertyName
  const storedKey = propertyKeyFromStoredName(defs, propertyName)
  if (storedKey && defs[storedKey]) return storedKey
  const base = propertyName.endsWith('Ids')
    ? pluralize(propertyName.slice(0, -3))
    : propertyName.endsWith('Id')
      ? propertyName.slice(0, -2)
      : undefined
  return base && defs[base] ? base : undefined
}

/**
 * Every property definition of one model ({@link getPropertyDefinitions}), with the model row
 * resolved from its name and scope. Empty when the model has no row. Throws AmbiguousModelError
 * for a bare name two schemas define.
 */
export async function getModelPropertyDefinitions(
  modelName: string | undefined,
  scope: ModelScope = {},
  db = BaseDb.getAppDb(),
): Promise<Map<string, PropertyDefinition>> {
  if (!db) return new Map()
  const { resolveModelRecord } = await import('../db/read/resolveModelRecord')
  const modelRecord = await resolveModelRecord(modelName, scope, db)
  if (!modelRecord?.id) return new Map()
  const { getPropertyDefinitions } = await import('./propertyDefinition')
  return getPropertyDefinitions(modelRecord.id, db)
}

/**
 * A property's definition, from its row ({@link getPropertyDefinition}), by model name and
 * property name. The name may be a stored metadata name (`authorId`, `tagIds`); the result's
 * `name` is the property's key. Undefined when the model or the property has no row.
 *
 * @example
 * ```typescript
 * const schema = await getPropertySchema('Article', 'title')
 * // { dataType: 'Text', name: 'title', id: '<schema file id>', validation: ..., ... }
 * const relation = await getPropertySchema('Article', 'authorId')
 * // { dataType: 'Relation', ref: 'Author', name: 'author', ... }
 * ```
 */
export const getPropertySchema = async (
  modelName: string,
  propertyName: string,
  /** Which model is meant when several schemas define one named modelName (Model.id and/or schema). */
  scope: { modelFileId?: string | null; schemaName?: string | null } = {},
): Promise<(Static<typeof TProperty> & PropertyDefinition & { _propertyFileId?: string }) | undefined> => {
  const definitions = await getModelPropertyDefinitions(modelName, scope)
  const defs = Object.fromEntries(definitions)
  const key = resolvePropertyKey(defs, propertyName)
  if (!key) return undefined
  const definition = definitions.get(key)!
  return {
    ...definition,
    modelName,
    _propertyFileId: definition.id,
  } as Static<typeof TProperty> & PropertyDefinition & { _propertyFileId?: string }
}
