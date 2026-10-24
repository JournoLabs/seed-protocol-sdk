import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties } from '@/seedSchema'
import { AmbiguousModelError } from '@/Model/errors'
import { resolveItemModelFileId, resolveModelRecordByNameOrType } from '@/db/read/resolveModelRecord'
import {
  getMetadataPropertyNamesForQuery,
  metadataStorageName,
  metadataStoredNameForms,
  propertyKeyFromStoredName,
} from '@/helpers/metadataPropertyNames'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/**
 * A properties row as metadata sees it (decision D4): `id` is what `metadata.property_id` holds,
 * `name` is the schema key, `storageName` the name new rows are written under.
 */
export type MetadataProperty = {
  id: number
  name: string
  modelId: number
  dataType: string
  refValueType: string | null
  /** The ref model's name (Relation, List of Relation). */
  ref: string | undefined
  schemaFileId: string | null
  storageName: string
}

const propertyColumns = {
  id: properties.id,
  name: properties.name,
  modelId: properties.modelId,
  dataType: properties.dataType,
  refValueType: properties.refValueType,
  schemaFileId: properties.schemaFileId,
  ref: models.name,
}

type PropertyRow = Omit<MetadataProperty, 'storageName' | 'ref'> & { ref: string | null }

const toMetadataProperty = (row: PropertyRow): MetadataProperty => {
  const ref = row.ref ?? undefined
  return {
    ...row,
    ref,
    storageName: metadataStorageName(row.name, {
      dataType: row.dataType,
      refValueType: row.refValueType ?? undefined,
      ref,
    }),
  }
}

const selectProperties = (db: Db, where: SQL | undefined): Promise<PropertyRow[]> =>
  db
    .select(propertyColumns)
    .from(properties)
    .leftJoin(models, eq(properties.refModelId, models.id))
    .where(where)

/** The model's properties with their storage names. */
export async function readModelMetadataProperties(db: Db, modelId: number): Promise<MetadataProperty[]> {
  return (await selectProperties(db, eq(properties.modelId, modelId))).map(toMetadataProperty)
}

/** The properties rows these ids name, by id. */
export async function readMetadataPropertiesById(
  db: Db,
  ids: Iterable<number | null | undefined>,
): Promise<Map<number, MetadataProperty>> {
  const wanted = [...new Set([...ids].filter((id): id is number => id != null))]
  const out = new Map<number, MetadataProperty>()
  if (wanted.length === 0) return out
  for (const row of await selectProperties(db, inArray(properties.id, wanted))) {
    out.set(row.id, toMetadataProperty(row))
  }
  return out
}

/** The property among `props` a stored metadata name belongs to: a key, else one of its stored forms. */
export function findMetadataPropertyByName(
  props: readonly MetadataProperty[],
  storedName: string,
): MetadataProperty | undefined {
  const defs = Object.fromEntries(
    props.map((p) => [p.name, { dataType: p.dataType, refValueType: p.refValueType ?? undefined, ref: p.ref }]),
  )
  const key = propertyKeyFromStoredName(defs, storedName)
  return key ? props.find((p) => p.name === key) : undefined
}

export type ResolveMetadataPropertyInput = {
  /** metadata.property_id when the caller already has it. */
  propertyId?: number | null
  /** The definition's id: the property's schemaFileId (string), or a properties.id (number). */
  definitionId?: string | number | null
  /** The property's name as the caller has it (schema key or a stored form). */
  propertyName?: string | null
  /** Model name or EAS model type. */
  modelName?: string | null
  /** schemaFileId of the item's models row. */
  modelFileId?: string | null
  /** The schema the model belongs to, when the model name alone is ambiguous. */
  schemaName?: string | null
  /** The item, to read seeds.model_file_id from when no modelFileId is given. */
  seedLocalId?: string | null
  seedUid?: string | null
}

/**
 * The properties row a metadata row belongs to: by property_id, else the definition's id
 * (properties.schema_file_id, unique table-wide), else by name within the item's model, where a
 * name is a key or one of its stored forms (`authorIdentityIds`, `authorId`). Undefined when
 * nothing matches.
 *
 * The model is the seed's own (model_file_id) when recorded, else the one the name or type
 * resolves to. That lookup throws AmbiguousModelError when the name exists in several schemas;
 * `onAmbiguousModel: 'none'` returns undefined instead.
 */
export async function resolveMetadataProperty(
  input: ResolveMetadataPropertyInput,
  db: Db | undefined = BaseDb.getAppDb(),
  options: { onAmbiguousModel?: 'throw' | 'none' } = {},
): Promise<MetadataProperty | undefined> {
  if (!db) return undefined
  const byId = async (where: SQL) => {
    const [row] = await selectProperties(db, where)
    return row ? toMetadataProperty(row) : undefined
  }
  if (input.propertyId != null) {
    const found = await byId(eq(properties.id, input.propertyId))
    if (found) return found
  }
  const { definitionId } = input
  if (typeof definitionId === 'number' && Number.isInteger(definitionId)) {
    const found = await byId(eq(properties.id, definitionId))
    if (found) return found
  } else if (typeof definitionId === 'string' && definitionId) {
    const found = await byId(eq(properties.schemaFileId, definitionId))
    if (found) return found
  }
  if (!input.propertyName) return undefined
  try {
    const modelFileId = await resolveItemModelFileId(
      { modelFileId: input.modelFileId, seedLocalId: input.seedLocalId, seedUid: input.seedUid },
      db,
    )
    if (!modelFileId && !input.modelName) return undefined
    const model = await resolveModelRecordByNameOrType(input.modelName, { modelFileId, schemaName: input.schemaName }, db)
    if (!model) return undefined
    return findMetadataPropertyByName(await readModelMetadataProperties(db, model.id), input.propertyName)
  } catch (error) {
    if (error instanceof AmbiguousModelError && options.onAmbiguousModel === 'none') return undefined
    throw error
  }
}

/** resolveMetadataProperty's id, or null. */
export async function resolveMetadataPropertyId(
  input: ResolveMetadataPropertyInput,
  db: Db | undefined = BaseDb.getAppDb(),
  options: { onAmbiguousModel?: 'throw' | 'none' } = {},
): Promise<number | null> {
  return (await resolveMetadataProperty(input, db, options))?.id ?? null
}

/** What a reader or writer needs to pick one property's rows: its id when it resolves, and the names
 * rows without one may be stored under. */
export type MetadataPropertyMatch = {
  property: MetadataProperty | undefined
  propertyId: number | null
  names: string[]
}

/** The stored-name forms of a resolved property (its key, storage name, `<key>Id`). */
export const metadataPropertyNameForms = (property: MetadataProperty): string[] =>
  metadataStoredNameForms(property.name, {
    dataType: property.dataType,
    refValueType: property.refValueType ?? undefined,
    ref: property.ref,
  })

/**
 * resolveMetadataProperty for a reader or writer that picks one property's rows: the id, and as
 * the fallback for rows with none, the names the property and `input.propertyName` may be stored
 * under. A model name that exists in several schemas gives no id (names only).
 */
export async function matchMetadataProperty(
  input: ResolveMetadataPropertyInput & { dataType?: string; refValueType?: string },
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<MetadataPropertyMatch> {
  const property = await resolveMetadataProperty(input, db, { onAmbiguousModel: 'none' })
  const names = new Set<string>(
    input.propertyName ? getMetadataPropertyNamesForQuery(input.propertyName, input.dataType, input.refValueType) : [],
  )
  if (property) for (const name of metadataPropertyNameForms(property)) names.add(name)
  return { property, propertyId: property?.id ?? null, names: [...names] }
}

type MetadataPropertyColumns = { propertyId: typeof metadata.propertyId; propertyName: typeof metadata.propertyName }

/**
 * Where-clause for one property's metadata rows: the rows linked by property_id, plus rows with no
 * property_id stored under one of `names`. With no id, the names alone.
 */
export function metadataRowsOfProperty(
  property: { propertyId?: number | null; names: readonly string[] },
  columns: MetadataPropertyColumns = metadata,
): SQL {
  const names = [...new Set(property.names.filter(Boolean))]
  const byName = names.length > 0 ? inArray(columns.propertyName, names) : sql`0`
  if (property.propertyId == null) return byName
  return or(eq(columns.propertyId, property.propertyId), and(isNull(columns.propertyId), byName))!
}

/** True when two metadata rows hold values of the same property: same property_id, else same name. */
export function sameMetadataProperty(
  a: { propertyId?: number | null; propertyName?: string | null },
  b: { propertyId?: number | null; propertyName?: string | null },
): boolean {
  if (a.propertyId != null && b.propertyId != null) return a.propertyId === b.propertyId
  return !!a.propertyName && a.propertyName === b.propertyName
}

export { METADATA_PROPERTY_GROUP_KEY_SQL } from '@/helpers/compareMetadataRowsLatestFirst'

/**
 * The schema key of a metadata row's property (properties.name through property_id), as a column
 * to select beside the row's own. Null for rows with no property_id.
 */
export const metadataPropertyKeyColumn = () =>
  sql<string | null>`(SELECT ${properties.name} FROM ${properties} WHERE ${properties.id} = ${metadata.propertyId})`
