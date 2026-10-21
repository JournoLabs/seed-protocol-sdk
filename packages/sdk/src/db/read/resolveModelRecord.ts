import { and, desc, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties } from '@/seedSchema/ModelSchema'
import { findSeedRow } from '@/db/read/findSeedRow'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { AmbiguousModelError } from '@/Model/errors'
import { localNamesInBestMatchTier } from '@seedprotocol/eas'
import { nameMatchLevels } from '@/db/read/nameMatchLevels'

/**
 * What is known about which model an item, property or lookup belongs to. Model names are only
 * unique within a schema, so a bare name is ambiguous once two schemas define the same model.
 */
export type ModelScope = {
  /** The model's schemaFileId (= Model.id, seeds.model_file_id). Most specific. */
  modelFileId?: string | null
  /** The models row id (e.g. properties.model_id). */
  modelId?: number | null
  schemaName?: string | null
  schemaId?: number | null
  /** A property's schemaFileId: the model that property row belongs to (properties.model_id). */
  propertyFileId?: string | null
  /**
   * With schemaName/schemaId: a name that the schema doesn't have resolves to nothing, instead of
   * falling back to the name alone (which can find the same-named model of another schema).
   */
  strict?: boolean
}

export type ResolvedModelRecord = {
  id: number
  name: string
  schemaFileId: string | null
}

// Same shape BaseDb.getAppDb() returns (better-sqlite3 or sqlite-proxy drizzle instance).
type Db = ReturnType<typeof BaseDb.getAppDb>

const columns = {
  id: modelsTable.id,
  name: modelsTable.name,
  schemaFileId: modelsTable.schemaFileId,
}

/**
 * Resolve a models row from a model name plus whatever scope is known, most specific first:
 * modelFileId, modelId, propertyFileId, then schemaId/schemaName + name, then the name alone (not
 * with `strict` and a schema scope). The name alone is only accepted when it is unambiguous;
 * otherwise this throws AmbiguousModelError.
 */
export const resolveModelRecord = async (
  modelName: string | undefined | null,
  scope: ModelScope = {},
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<ResolvedModelRecord | undefined> => {
  if (!db) return undefined

  if (scope.modelFileId) {
    const rows = await db
      .select(columns)
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, scope.modelFileId))
      .limit(1)
    if (rows.length > 0) return rows[0] as ResolvedModelRecord
  }

  if (scope.modelId) {
    const rows = await db.select(columns).from(modelsTable).where(eq(modelsTable.id, scope.modelId)).limit(1)
    if (rows.length > 0) return rows[0] as ResolvedModelRecord
  }

  if (scope.propertyFileId) {
    const rows = await db
      .select(columns)
      .from(properties)
      .innerJoin(modelsTable, eq(properties.modelId, modelsTable.id))
      .where(eq(properties.schemaFileId, scope.propertyFileId))
      .limit(1)
    if (rows.length > 0) return rows[0] as ResolvedModelRecord
  }

  if (!modelName) return undefined

  if (scope.schemaId || scope.schemaName) {
    const rows = await db
      .select(columns)
      .from(modelsTable)
      .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(
        and(
          eq(modelsTable.name, modelName),
          scope.schemaId ? eq(schemasTable.id, scope.schemaId) : eq(schemasTable.name, scope.schemaName!),
        ),
      )
      .limit(1)
    if (rows.length > 0) return rows[0] as ResolvedModelRecord
    if (scope.strict) return undefined
  }

  return resolveModelRecordByNameOnly(modelName, db)
}

/**
 * Name of the schema a models row is linked to (the newest version's when several are), or
 * undefined for an unlinked stub.
 */
export const getModelSchemaName = async (
  modelId: number,
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<string | undefined> => {
  if (!db) return undefined
  const rows = await db
    .select({ schemaName: schemasTable.name })
    .from(modelSchemas)
    .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
    .where(eq(modelSchemas.modelId, modelId))
    .orderBy(desc(schemasTable.version))
    .limit(1)
  return rows[0]?.schemaName ?? undefined
}

/** The model a property row (by its schemaFileId) belongs to, and the property's data type. */
export const resolvePropertyModelRecord = async (
  propertyFileId: string | undefined | null,
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<(ResolvedModelRecord & { dataType: string }) | undefined> => {
  if (!db || !propertyFileId) return undefined
  const rows = await db
    .select({ ...columns, dataType: properties.dataType })
    .from(properties)
    .innerJoin(modelsTable, eq(properties.modelId, modelsTable.id))
    .where(eq(properties.schemaFileId, propertyFileId))
    .limit(1)
  const row = rows[0]
  return row ? { id: row.id, name: row.name, schemaFileId: row.schemaFileId, dataType: row.dataType ?? '' } : undefined
}

/**
 * Name-only resolution. Rows linked to a schema win over unlinked stubs (null-schemaFileId rows
 * from ref resolution); if more than one linked row has the name it is ambiguous and this throws.
 * `label` names the lookup in the error (defaults to the model name).
 */
const resolveModelRecordByNameOnly = async (
  modelName: string | string[],
  db: NonNullable<Db>,
  label: string = Array.isArray(modelName) ? modelName.join(', ') : modelName,
): Promise<ResolvedModelRecord | undefined> => {
  const rows = (await db
    .select({ ...columns, schemaName: schemasTable.name })
    .from(modelsTable)
    .leftJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
    .leftJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
    .where(Array.isArray(modelName) ? inArray(modelsTable.name, modelName) : eq(modelsTable.name, modelName))
    .orderBy(desc(modelsTable.id))) as (ResolvedModelRecord & { schemaName: string | null })[]
  if (rows.length === 0) return undefined

  const linked = rows.filter((r) => r.schemaName)
  const linkedIds = new Set(linked.map((r) => r.id))
  if (linkedIds.size > 1) {
    throw new AmbiguousModelError(
      label,
      linked.map((r) => r.schemaName!),
    )
  }
  const chosen = linked[0] ?? rows[0]
  return { id: chosen.id, name: chosen.name, schemaFileId: chosen.schemaFileId }
}

/**
 * The model names a model name or EAS model type can refer to: the name itself, else the names
 * that match it in the tightest tier (ADR 0008, as Model.findByModelType matches): `new_model` →
 * "New model", `sync_storage_post` → "SyncStoragePost", `htmlpage` → "HTMLPage". Each name at its
 * nameMatch level (ADR 0009).
 */
const modelNamesForNameOrType = async (nameOrType: string, db: NonNullable<Db>): Promise<string[]> => {
  const rows = (await db.selectDistinct({ name: modelsTable.name }).from(modelsTable)) as { name: string }[]
  const names = rows.map((r) => r.name)
  if (names.includes(nameOrType)) return [nameOrType]
  const levels = await nameMatchLevels(db)
  return [...localNamesInBestMatchTier(nameOrType, names, { level: (name) => levels.model(name) })]
}

/**
 * resolveModelRecord for a model name **or** an EAS model type (snake_case model name, what sync
 * stores in seeds.type): "New model" resolves from `new_model`. Scope and ambiguity behave as in
 * resolveModelRecord: modelFileId/modelId first, then the schema, then the name(s) alone, which throws
 * AmbiguousModelError when models in several schemas match.
 */
export const resolveModelRecordByNameOrType = async (
  nameOrType: string | undefined | null,
  scope: ModelScope = {},
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<ResolvedModelRecord | undefined> => {
  if (!db) return undefined
  if (scope.modelFileId || scope.modelId || scope.propertyFileId) {
    const byId = await resolveModelRecord(undefined, scope, db)
    if (byId) return byId
  }
  if (!nameOrType) return undefined

  const names = await modelNamesForNameOrType(nameOrType, db)
  if (names.length === 0) return undefined
  if (names.length === 1) {
    return resolveModelRecord(
      names[0],
      { ...scope, modelFileId: undefined, modelId: undefined, propertyFileId: undefined },
      db,
    )
  }

  // Several model names map to this type (e.g. "New model" and "NewModel" in different schemas).
  if (scope.schemaId || scope.schemaName) {
    const rows = (await db
      .select(columns)
      .from(modelsTable)
      .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(
        and(
          inArray(modelsTable.name, names),
          scope.schemaId ? eq(schemasTable.id, scope.schemaId) : eq(schemasTable.name, scope.schemaName!),
        ),
      )) as ResolvedModelRecord[]
    if (new Set(rows.map((r) => r.id)).size === 1) return rows[0]
    if (scope.strict && rows.length === 0) return undefined
  }
  return resolveModelRecordByNameOnly(names, db, nameOrType)
}

/**
 * Work out which model (schemaFileId) an item belongs to from whatever is at hand: an explicit
 * modelFileId, the seed's model_file_id, or a metadata row's property_id → properties.model_id.
 */
export const resolveItemModelFileId = async (
  hints: {
    modelFileId?: string | null
    seedLocalId?: string | null
    seedUid?: string | null
    propertyId?: number | null
  },
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<string | undefined> => {
  if (hints.modelFileId) return hints.modelFileId
  if (!db) return undefined
  if (hints.seedLocalId || hints.seedUid) {
    const seed = await findSeedRow({ localId: hints.seedLocalId, uid: hints.seedUid }, db)
    if (seed?.modelFileId) return seed.modelFileId
  }
  if (hints.propertyId) {
    const rows = await db
      .select({ modelFileId: modelsTable.schemaFileId })
      .from(properties)
      .innerJoin(modelsTable, eq(properties.modelId, modelsTable.id))
      .where(eq(properties.id, hints.propertyId))
      .limit(1)
    if (rows[0]?.modelFileId) return rows[0].modelFileId
  }
  return undefined
}

type ItemScopeContext = {
  modelFileId?: string
  schemaName?: string
  seedLocalId?: string
  seedUid?: string
  propertyId?: number
}

/** ModelScope for an Item (or ItemProperty) instance: its recorded modelFileId (context or seed row) and schemaName. */
export const getItemModelScope = async (item: {
  seedLocalId?: string
  seedUid?: string
  getService?: () => { getSnapshot: () => { context?: ItemScopeContext } }
}): Promise<{ modelFileId?: string; schemaName?: string }> => {
  let context: ItemScopeContext | undefined
  try {
    context = item.getService?.().getSnapshot().context
  } catch {
    context = undefined
  }
  const modelFileId = await resolveItemModelFileId({
    modelFileId: context?.modelFileId,
    seedLocalId: item.seedLocalId ?? context?.seedLocalId,
    seedUid: item.seedUid ?? context?.seedUid,
    propertyId: context?.propertyId,
  })
  return { modelFileId, schemaName: context?.schemaName }
}

/**
 * Resolve a ref (e.g. a Relation's target model) by name from the schema(s) its owning model belongs
 * to, so "Tag" means the owner schema's Tag rather than any Tag. Falls back to resolveModelRecord.
 */
export const resolveRefModelRecord = async (
  refModelName: string | undefined | null,
  owner: ModelScope,
  db: Db | undefined = BaseDb.getAppDb(),
): Promise<ResolvedModelRecord | undefined> => {
  if (!db || !refModelName) return undefined
  const ownerRow = owner.modelFileId || owner.modelId ? await resolveModelRecord(undefined, owner, db) : undefined
  const schemaFilter = ownerRow
    ? inArray(
        modelSchemas.schemaId,
        // any schema the owner is linked to
        db.select({ schemaId: modelSchemas.schemaId }).from(modelSchemas).where(eq(modelSchemas.modelId, ownerRow.id)),
      )
    : owner.schemaId
      ? eq(modelSchemas.schemaId, owner.schemaId)
      : owner.schemaName
        ? eq(schemasTable.name, owner.schemaName)
        : undefined
  if (schemaFilter) {
    const rows = await db
      .select(columns)
      .from(modelsTable)
      .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(and(eq(modelsTable.name, refModelName), schemaFilter))
      .limit(1)
    if (rows.length > 0) return rows[0] as ResolvedModelRecord
  }
  return resolveModelRecord(refModelName, {}, db)
}
