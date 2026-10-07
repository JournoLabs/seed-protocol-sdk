import { eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'
import { schemas } from '@/seedSchema/SchemaSchema'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { modelUids } from '@/seedSchema/ModelUidSchema'
import { propertyUids } from '@/seedSchema/PropertyUidSchema'
import { metadata } from '@/seedSchema/MetadataSchema'
import { cleanupTestSchemaFiles } from './cleanupTestSchemaFiles'

export type CleanupTestSchemaDataOptions = {
  /** How many times to retry after an FK failure before giving up (default 10). */
  retries?: number
  /** Delay between retries in ms (default 200). */
  retryDelayMs?: number
}

/**
 * Removes every schema/model/property row a test created while keeping the 'Seed Protocol' schema and its
 * models, which client initialization depends on.
 *
 * 1. Evicts cached Model / ModelProperty instances for each non-Seed-Protocol schema. That stops their actors
 *    (no new writes) and makes the next import build fresh instances instead of reusing ones bound to
 *    deleted rows.
 * 2. Deletes in FK order: properties.refModelId -> null, metadata.propertyId -> null, property_uids,
 *    model_uids, properties, model_schemas, models, schemas.
 * 3. Retries briefly on failure: a write a previous test started (e.g. writeModelToDb inserting a
 *    model_schemas row) can't be cancelled by stopping its actor and may land mid-cleanup.
 * 4. Deletes the test schema JSON files from the working dir, so the next client.init doesn't
 *    re-import the schemas whose rows were just removed.
 */
export async function cleanupTestSchemaData(options: CleanupTestSchemaDataOptions = {}): Promise<void> {
  const { retries = 10, retryDelayMs = 200 } = options
  const db = BaseDb.getAppDb()
  if (!db) return

  const testSchemaRows = await db
    .select({ name: schemas.name })
    .from(schemas)
    .where(ne(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
  for (const { name } of testSchemaRows) {
    if (name) ModelProperty.evictForModels(Model.evictForSchema(name), name)
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await deleteTestRows(db)
      await cleanupTestSchemaFiles()
      return
    } catch (error) {
      if (attempt >= retries) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
}

async function deleteTestRows(db: NonNullable<ReturnType<typeof BaseDb.getAppDb>>): Promise<void> {
  const seedProtocolSchema = await db
    .select({ id: schemas.id })
    .from(schemas)
    .where(eq(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
    .limit(1)
  const seedProtocolSchemaId = seedProtocolSchema[0]?.id ?? null

  const seedProtocolModelIds: number[] =
    seedProtocolSchemaId == null
      ? []
      : (
          await db
            .select({ modelId: modelSchemas.modelId })
            .from(modelSchemas)
            .where(eq(modelSchemas.schemaId, seedProtocolSchemaId))
        )
          .map((link: { modelId: number | null }) => link.modelId)
          .filter((id: number | null): id is number => id !== null)

  // Every model that isn't a Seed Protocol model, including orphans not linked to any schema.
  const isTestModel = (column: typeof propertiesTable.modelId | typeof modelsTable.id) =>
    seedProtocolModelIds.length > 0 ? notInArray(column, seedProtocolModelIds) : undefined

  const testPropertyIds: number[] = (
    await db.select({ id: propertiesTable.id }).from(propertiesTable).where(isTestModel(propertiesTable.modelId))
  ).map((row: { id: number }) => row.id)
  const testModelIds: number[] = (
    await db.select({ id: modelsTable.id }).from(modelsTable).where(isTestModel(modelsTable.id))
  ).map((row: { id: number }) => row.id)

  await db.update(propertiesTable).set({ refModelId: null }).where(isTestModel(propertiesTable.modelId))
  if (testPropertyIds.length > 0) {
    await db.update(metadata).set({ propertyId: null }).where(inArray(metadata.propertyId, testPropertyIds))
    await db.delete(propertyUids).where(inArray(propertyUids.propertyId, testPropertyIds))
  }
  if (testModelIds.length > 0) {
    await db.delete(modelUids).where(inArray(modelUids.modelId, testModelIds))
  }
  await db.delete(propertiesTable).where(isTestModel(propertiesTable.modelId))
  await db
    .delete(modelSchemas)
    .where(
      seedProtocolSchemaId == null
        ? undefined
        : or(ne(modelSchemas.schemaId, seedProtocolSchemaId), isNull(modelSchemas.schemaId)),
    )
  await db.delete(modelsTable).where(isTestModel(modelsTable.id))
  await db.delete(schemas).where(or(ne(schemas.name, SEED_PROTOCOL_SCHEMA_NAME), isNull(schemas.name)))
}
