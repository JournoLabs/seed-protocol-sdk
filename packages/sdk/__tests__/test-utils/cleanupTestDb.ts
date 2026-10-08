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
import { seeds } from '@/seedSchema/SeedSchema'
import { versions } from '@/seedSchema/VersionSchema'
import { publishProcesses } from '@/seedSchema/PublishProcessSchema'
import { cleanupTestSchemaFiles } from './cleanupTestSchemaFiles'
import { waitForInFlightWrites } from '@/services/write/actors/writeToDatabase'

export type CleanupTestSchemaDataOptions = {
  /** How many times to retry after an FK failure before giving up (default 10). */
  retries?: number
  /** Delay between retries in ms (default 200). */
  retryDelayMs?: number
  /**
   * Also delete the test models' items: seeds whose model_file_id is a test model's, with their versions,
   * metadata and publish processes. Matches by model_file_id, not seeds.type, so it neither misses items
   * (types are snake_case, model names aren't) nor deletes another schema's same-named items.
   */
  items?: boolean
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
 * 3. Waits for writes already running (stopping an actor can't cancel them), then retries briefly on
 *    failure in case a write still lands mid-cleanup. Evicts once more after the deletes, since reads
 *    still running from client.init can re-create instances from the rows until they're gone.
 * With `items: true`, first deletes the test models' items (see the option).
 * 4. Deletes the test schema JSON files from the working dir, or the next client.init re-imports the
 *    schemas whose rows were just removed. Matters most in the browser, where test files share one
 *    OPFS store; under Node each run gets a fresh temp dir.
 */
export async function cleanupTestSchemaData(options: CleanupTestSchemaDataOptions = {}): Promise<void> {
  const { retries = 10, retryDelayMs = 200, items = false } = options
  const db = BaseDb.getAppDb()
  if (!db) return

  const testSchemaRows = await db
    .select({ name: schemas.name })
    .from(schemas)
    .where(ne(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
  evictTestSchemaInstances(testSchemaRows)
  // Evicting stops new writes but can't cancel running ones; deleting under them fails their join/FK steps
  await waitForInFlightWrites()

  for (let attempt = 0; ; attempt++) {
    try {
      await deleteTestRows(db, { items })
      // Evict again: work still running from client.init when we first evicted (e.g. a ModelProperty
      // resolving its model via Model.getByNameAsync) re-creates Model instances from the rows being
      // deleted. With the rows gone nothing re-creates them, so this pass leaves the cache clean.
      evictTestSchemaInstances(testSchemaRows)
      await cleanupTestSchemaFiles()
      return
    } catch (error) {
      if (attempt >= retries) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
}

function evictTestSchemaInstances(testSchemaRows: { name: string | null }[]): void {
  for (const { name } of testSchemaRows) {
    if (name) ModelProperty.evictForModels(Model.evictForSchema(name), name)
  }
}

async function deleteTestRows(
  db: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  { items }: { items: boolean },
): Promise<void> {
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

  if (items) await deleteTestItemRows(db, seedProtocolModelIds)

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

/**
 * Deletes only the test models' items (seeds whose model_file_id is a non-Seed-Protocol model's, with
 * their versions, metadata and publish processes) and leaves schemas, models and cached instances alone.
 * For files that import their schema once and need an empty item table per test: re-importing and
 * evicting per test makes the next import and every Item.create slower (cold Model instances).
 */
export async function cleanupTestItems(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  const seedProtocolSchema = await db
    .select({ id: schemas.id })
    .from(schemas)
    .where(eq(schemas.name, SEED_PROTOCOL_SCHEMA_NAME))
    .limit(1)
  const seedProtocolModelIds: number[] =
    seedProtocolSchema[0]?.id == null
      ? []
      : (
          await db
            .select({ modelId: modelSchemas.modelId })
            .from(modelSchemas)
            .where(eq(modelSchemas.schemaId, seedProtocolSchema[0].id))
        )
          .map((link: { modelId: number | null }) => link.modelId)
          .filter((id: number | null): id is number => id !== null)
  await deleteTestItemRows(db, seedProtocolModelIds)
}

async function deleteTestItemRows(
  db: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  seedProtocolModelIds: number[],
): Promise<void> {
  const testModelFileIds = (
    await db
      .select({ schemaFileId: modelsTable.schemaFileId })
      .from(modelsTable)
      .where(seedProtocolModelIds.length > 0 ? notInArray(modelsTable.id, seedProtocolModelIds) : undefined)
  )
    .map((row: { schemaFileId: string | null }) => row.schemaFileId)
    .filter((id: string | null): id is string => !!id)
  if (testModelFileIds.length === 0) return
  const seedLocalIds = (
    await db.select({ localId: seeds.localId }).from(seeds).where(inArray(seeds.modelFileId, testModelFileIds))
  )
    .map((row: { localId: string | null }) => row.localId)
    .filter((id: string | null): id is string => !!id)
  if (seedLocalIds.length === 0) return
  await db.delete(publishProcesses).where(inArray(publishProcesses.seedLocalId, seedLocalIds))
  await db.delete(metadata).where(inArray(metadata.seedLocalId, seedLocalIds))
  await db.delete(versions).where(inArray(versions.seedLocalId, seedLocalIds))
  await db.delete(seeds).where(inArray(seeds.localId, seedLocalIds))
}
