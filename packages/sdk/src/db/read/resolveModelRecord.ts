import { and, desc, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties } from '@/seedSchema/ModelSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { AmbiguousModelError } from '@/Model/errors'

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
 * modelFileId, modelId, then schemaId/schemaName + name, then the name alone. The name alone is
 * only accepted when it is unambiguous; otherwise this throws AmbiguousModelError.
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
  }

  return resolveModelRecordByNameOnly(modelName, db)
}

/**
 * Name-only resolution. Rows linked to a schema win over unlinked stubs (null-schemaFileId rows
 * from ref resolution); if more than one linked row has the name it is ambiguous and this throws.
 */
const resolveModelRecordByNameOnly = async (
  modelName: string,
  db: NonNullable<Db>,
): Promise<ResolvedModelRecord | undefined> => {
  const rows = (await db
    .select({ ...columns, schemaName: schemasTable.name })
    .from(modelsTable)
    .leftJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
    .leftJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
    .where(eq(modelsTable.name, modelName))
    .orderBy(desc(modelsTable.id))) as (ResolvedModelRecord & { schemaName: string | null })[]
  if (rows.length === 0) return undefined

  const linked = rows.filter((r) => r.schemaName)
  const linkedIds = new Set(linked.map((r) => r.id))
  if (linkedIds.size > 1) {
    throw new AmbiguousModelError(
      modelName,
      linked.map((r) => r.schemaName!),
    )
  }
  const chosen = linked[0] ?? rows[0]
  return { id: chosen.id, name: chosen.name, schemaFileId: chosen.schemaFileId }
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
    const rows = await db
      .select({ modelFileId: seeds.modelFileId })
      .from(seeds)
      .where(hints.seedLocalId ? eq(seeds.localId, hints.seedLocalId) : eq(seeds.uid, hints.seedUid!))
      .limit(1)
    if (rows[0]?.modelFileId) return rows[0].modelFileId
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
