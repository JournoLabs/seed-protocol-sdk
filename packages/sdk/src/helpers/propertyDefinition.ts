import { and, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { Static } from '@sinclair/typebox'
import { BaseDb } from '@/db/Db/BaseDb'
import { models, properties, type PropertyType } from '@/seedSchema'
import { ModelPropertyDataTypes, normalizeDataType, normalizePropertyRecordSchema, type TProperty } from '@/helpers/property/index'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/**
 * A property's definition as its row stores it (ADR 0016, audit decision D7): the `definition`
 * column read in the internal shape (`dataType`, `ref`, `storageType`, ...), with the row's columns
 * winning for the fields they hold. `id` is the schema file id, `_dbId` the row id, `modelId` the
 * model row id.
 */
export type PropertyDefinition = Omit<Static<typeof TProperty>, 'modelId' | 'name' | 'id'> & {
  id?: string
  name: string
  _dbId: number
  modelId: number
  refModelId?: number
  refModelName?: string
  description?: string
  [key: string]: unknown
}

/** Schema file spellings that normalizePropertyRecordSchema maps to internal fields. */
const FILE_ALIAS_KEYS = ['type', 'model', 'items', 'storage']

/**
 * Fields an instance or a row carries that aren't part of the definition. Keys starting with `_`
 * (`_dbId`, `_propertyFileId`, `_originalValues`, ...) are dropped too.
 */
const NON_DEFINITION_KEYS = new Set([
  ...FILE_ALIAS_KEYS,
  'name',
  'modelId',
  'modelName',
  'refModelId',
  'refModelName',
  'schemaName',
  'isEdited',
  'TObject',
])

const parseDefinition = (json: string | null | undefined): Record<string, any> => {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** A definition in any accepted shape, reduced to what the column stores. */
const toStoredDefinition = (def: Record<string, any>): Record<string, any> => {
  const normalized = normalizePropertyRecordSchema(def ?? {}) as Record<string, any>
  const hasRef =
    normalized.dataType === ModelPropertyDataTypes.Relation || normalized.dataType === ModelPropertyDataTypes.List
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(normalized)) {
    if (value === undefined || typeof value === 'function') continue
    if (key.startsWith('_') || NON_DEFINITION_KEYS.has(key)) continue
    if (key === 'ref' && !hasRef) continue
    out[key] = value
  }
  return out
}

/**
 * The `definition` column value for a definition in any accepted shape (schema file property,
 * Model.create property, ModelProperty context). With `previous` (the row's current value), fields
 * the new definition doesn't have are kept: a write that only knows the columns (a creation
 * payload, a row-built instance) must not drop the validation a schema file or code stored.
 */
export function propertyDefinitionColumn(def: Record<string, any>, previous?: string | null): string {
  const stored = toStoredDefinition(def)
  return JSON.stringify(previous ? { ...toStoredDefinition(parseDefinition(previous)), ...stored } : stored)
}

/**
 * A row as a {@link PropertyDefinition}. `refModelName` is the name of the row's `ref_model_id`
 * model; without one, a Relation or List keeps the definition's `ref` (a target not stored yet).
 */
export function propertyDefinitionFromRow(row: PropertyType, refModelName?: string | null): PropertyDefinition {
  const stored = toStoredDefinition(parseDefinition(row.definition))
  const dataType = normalizeDataType(row.dataType)
  const hasRef = dataType === ModelPropertyDataTypes.Relation || dataType === ModelPropertyDataTypes.List
  const ref = refModelName ?? (hasRef ? stored.ref : undefined)
  const def: Record<string, unknown> = {
    ...stored,
    id: row.schemaFileId ?? undefined,
    _dbId: row.id,
    name: row.name,
    modelId: row.modelId,
    dataType,
    ref,
    refModelName: ref,
    refModelId: row.refModelId ?? undefined,
    refValueType: row.refValueType ? normalizeDataType(row.refValueType) : undefined,
    storageType: row.storageType ?? undefined,
    localStorageDir: row.localStorageDir ?? undefined,
    filenameSuffix: row.filenameSuffix ?? undefined,
    required: row.required ?? stored.required ?? undefined,
  }
  for (const key of Object.keys(def)) if (def[key] === undefined) delete def[key]
  return def as PropertyDefinition
}

const refModels = alias(models, 'ref_model')

const selectDefinitionRows = (db: Db) =>
  db
    .select({ property: properties, refModelName: refModels.name })
    .from(properties)
    .leftJoin(refModels, eq(refModels.id, properties.refModelId))

/**
 * The complete definition of one property, from its row: by row id (`metadata.property_id`), or by
 * model row id and property name. Undefined when there's no such row.
 */
export async function getPropertyDefinition(
  target: number | { modelId: number; name: string },
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<PropertyDefinition | undefined> {
  if (!db) throw new Error('Database not available')
  const where =
    typeof target === 'number'
      ? eq(properties.id, target)
      : and(eq(properties.modelId, target.modelId), eq(properties.name, target.name))
  const [row] = await selectDefinitionRows(db).where(where).limit(1)
  return row ? propertyDefinitionFromRow(row.property, row.refModelName) : undefined
}

/** {@link getPropertyDefinition} for every property of one model, by property name, in one read. */
export async function getPropertyDefinitions(
  modelId: number,
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<Map<string, PropertyDefinition>> {
  if (!db) throw new Error('Database not available')
  const rows = await selectDefinitionRows(db).where(eq(properties.modelId, modelId))
  return new Map(
    rows.map((row: { property: PropertyType; refModelName: string | null }) => [
      row.property.name,
      propertyDefinitionFromRow(row.property, row.refModelName),
    ]),
  )
}

/** {@link getPropertyDefinition} for each of these property file ids that has a row, by file id. */
export async function getPropertyDefinitionsByFileId(
  propertyFileIds: string[],
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<Map<string, PropertyDefinition>> {
  if (!db) throw new Error('Database not available')
  if (propertyFileIds.length === 0) return new Map()
  const rows = await selectDefinitionRows(db).where(inArray(properties.schemaFileId, propertyFileIds))
  return new Map(
    rows.map((row: { property: PropertyType; refModelName: string | null }) => [
      row.property.schemaFileId!,
      propertyDefinitionFromRow(row.property, row.refModelName),
    ]),
  )
}

/** Fields only a definition holds (no column), which code-defined properties can set. */
export const DEFINITION_ONLY_FIELDS = ['validation', 'htmlEmbeddedDataUriPolicy', 'description'] as const

/** The {@link DEFINITION_ONLY_FIELDS} a definition sets. */
export const definitionOnlyFields = (def: Record<string, any>): Record<string, unknown> =>
  Object.fromEntries(DEFINITION_ONLY_FIELDS.filter((key) => def?.[key] !== undefined).map((key) => [key, def[key]]))

/**
 * Stores code-defined fields ({@link definitionOnlyFields}) in the row's definition, when the row
 * exists and its definition differs. For properties whose row was written before the code that
 * defines them ran (a schema file's row, an earlier run), so their rules persist at create time.
 */
export async function persistDefinitionFields(
  where: { schemaFileId: string } | { id: number },
  fields: Record<string, unknown>,
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<void> {
  if (!db || Object.keys(fields).length === 0) return
  const condition = 'id' in where ? eq(properties.id, where.id) : eq(properties.schemaFileId, where.schemaFileId)
  const [row] = await db.select({ id: properties.id, definition: properties.definition }).from(properties).where(condition).limit(1)
  if (!row) return
  const next = propertyDefinitionColumn(fields, row.definition)
  if (row.definition && JSON.stringify(toStoredDefinition(parseDefinition(row.definition))) === next) return
  await db.update(properties).set({ definition: next }).where(eq(properties.id, row.id))
}
