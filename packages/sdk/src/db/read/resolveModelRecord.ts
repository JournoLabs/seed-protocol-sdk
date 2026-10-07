import { and, desc, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties } from '@/seedSchema/ModelSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import debug from 'debug'

const logger = debug('seedSdk:db:read:resolveModelRecord')

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

const warnedAmbiguous = new Set<string>()

/**
 * Resolve a models row from a model name plus whatever scope is known, most specific first:
 * modelFileId, modelId, then schemaId/schemaName + name. The name-only fallback is for data that
 * predates seeds.model_file_id (and EAS-synced seeds, whose schema is keyed by model name only);
 * when several rows share the name it picks the most recently created one and logs a warning.
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

  const byName = (await db
    .select(columns)
    .from(modelsTable)
    .where(eq(modelsTable.name, modelName))
    .orderBy(desc(modelsTable.id))) as ResolvedModelRecord[]
  if (byName.length > 1 && !warnedAmbiguous.has(modelName)) {
    warnedAmbiguous.add(modelName)
    logger(
      `Model name "${modelName}" exists in ${byName.length} rows and no schema/model id was given; using the newest (id ${byName[0].id})`,
    )
  }
  return byName[0]
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
