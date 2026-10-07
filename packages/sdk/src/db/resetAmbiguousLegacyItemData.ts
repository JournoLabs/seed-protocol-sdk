import { eq, isNotNull, isNull, and } from 'drizzle-orm'
import { toSnakeCase } from 'drizzle-orm/casing'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import {
  appState,
  arweaveL1FinalizeJobs,
  easSyncProcesses,
  htmlEmbeddedImageCoPublish,
  metadata,
  models,
  publishProcesses,
  schemas,
  seeds,
  uploadProcesses,
  modelSchemas,
  versions,
} from '@/seedSchema'

const logger = debug('seedSdk:db:resetAmbiguousLegacyItemData')

/** appState key recording that the one-time check after migration 0015 has run. */
export const LEGACY_ITEM_MODEL_CHECK_KEY = 'legacyItemModelCheck:v1'

/**
 * One-time check after seeds.model_file_id was introduced (migration 0015). Seeds from before then
 * that couldn't be backfilled have no model; if their model name now exists in more than one schema
 * there is no way to tell which model they belong to. In that case the local item data (seeds,
 * versions, metadata and the jobs that reference them) is cleared, keeping schemas and models;
 * published items come back on the next EAS sync.
 *
 * Runs once (not on every start): EAS-synced seeds also lack model_file_id until
 * resolveModelForSyncedSeed exists, and re-checking would clear the DB after every sync.
 * TODO: replace the reset with a migration path once there is real user data at stake.
 *
 * @returns true if item data was cleared
 */
export const resetAmbiguousLegacyItemData = async (): Promise<boolean> => {
  const db = BaseDb.getAppDb()
  if (!db) return false

  const done = await db.select({ key: appState.key }).from(appState).where(eq(appState.key, LEGACY_ITEM_MODEL_CHECK_KEY)).limit(1)
  if (done.length > 0) return false

  const markDone = () =>
    db
      .insert(appState)
      .values({ key: LEGACY_ITEM_MODEL_CHECK_KEY, value: String(Date.now()), createdAt: Date.now(), updatedAt: Date.now() })
      .onConflictDoNothing()

  const legacyTypes = (await db
    .selectDistinct({ type: seeds.type })
    .from(seeds)
    .where(and(isNull(seeds.modelFileId), isNotNull(seeds.type)))) as { type: string }[]
  if (legacyTypes.length === 0) {
    await markDone()
    return false
  }

  // Which seed types (snake_case model names) map to models in more than one schema
  const linkedModels = (await db
    .select({ modelId: models.id, modelName: models.name, schemaName: schemas.name })
    .from(models)
    .innerJoin(modelSchemas, eq(models.id, modelSchemas.modelId))
    .innerJoin(schemas, eq(modelSchemas.schemaId, schemas.id))) as {
    modelId: number
    modelName: string
    schemaName: string
  }[]
  const byType = new Map<string, { modelIds: Set<number>; schemaNames: Set<string> }>()
  for (const row of linkedModels) {
    const type = toSnakeCase(row.modelName)
    const entry = byType.get(type) ?? { modelIds: new Set(), schemaNames: new Set() }
    entry.modelIds.add(row.modelId)
    entry.schemaNames.add(row.schemaName)
    byType.set(type, entry)
  }
  const ambiguous = legacyTypes
    .map(({ type }) => ({ type, entry: byType.get(type) }))
    .filter(({ entry }) => entry && entry.modelIds.size > 1)

  if (ambiguous.length === 0) {
    await markDone()
    return false
  }

  const details = ambiguous
    .map(({ type, entry }) => `"${type}" (schemas: ${[...entry!.schemaNames].sort().join(', ')})`)
    .join('; ')
  console.warn(
    `[seed-protocol] Clearing local item data: items created before this SDK version don't record ` +
      `which model they belong to, and these model names now exist in more than one schema: ${details}. ` +
      `Schemas and models are kept; published items will be restored by the next EAS sync.`,
  )
  logger(`Clearing item data for ambiguous legacy seed types: ${details}`)

  for (const table of [
    htmlEmbeddedImageCoPublish,
    arweaveL1FinalizeJobs,
    uploadProcesses,
    publishProcesses,
    easSyncProcesses,
    metadata,
    versions,
    seeds,
  ]) {
    await db.delete(table)
  }
  await markDone()
  return true
}
