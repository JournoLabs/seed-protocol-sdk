import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types'
import { SchemaMachineContext } from '../schemaMachine'
import { listLatestSchemaFiles, readSchemaFile } from '@/helpers/schema'
import { applySchemaFile, resolveSchemaRow } from '@/helpers/schemaApply'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { eq, desc } from 'drizzle-orm'
import debug from 'debug'
import { currentEvictionEpoch } from '@/helpers/entity/evictionEpoch'
import { INTERNAL_SCHEMA_IDS, SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const logger = debug('seedSdk:schema:actors:checkExistingSchema')

/**
 * Query model IDs (schemaFileId) from database for a given schema
 */
const getModelIdsForSchema = async (schemaId: number): Promise<string[]> => {
  const db = BaseDb.getAppDb()
  if (!db) {
    logger('Database not available, cannot query model IDs')
    return []
  }

  try {
    const modelRecords = await db
      .select({
        modelFileId: modelsTable.schemaFileId,
      })
      .from(modelSchemas)
      .innerJoin(modelsTable, eq(modelSchemas.modelId, modelsTable.id))
      .where(eq(modelSchemas.schemaId, schemaId))
    
    const modelIds = modelRecords
      .map((row: { modelFileId: string | null }) => row.modelFileId)
      .filter((id: string | null | undefined): id is string => id !== null && id !== undefined)
    
    logger(`Found ${modelIds.length} model IDs for schema (id: ${schemaId}): ${modelIds.join(', ')}`)
    return modelIds
  } catch (error) {
    logger(`Error querying model IDs for schema ${schemaId}:`, error)
    return []
  }
}

/**
 * Create Model instances for all model IDs to ensure they're cached
 */
const createModelInstances = async (modelIds: string[], evictionEpoch: number): Promise<void> => {
  if (modelIds.length === 0) {
    return
  }

  try {
    const mod = await import('../../../Model/Model')
    const Model = mod?.Model ?? (mod as { default?: unknown })?.default
    if (!Model) {
      logger('Model not available from dynamic import')
      return
    }
    const createPromises = modelIds.map(async (modelFileId) => {
      try {
        // Not if the schema was evicted (Schema.destroy, test cleanup) since this check started
        const schemaHold = Model.takeSchemaHold(modelFileId)
        const model = await Model.createById(modelFileId, { evictionEpoch, ...(!schemaHold && { hold: false as const }) })
        if (!model && schemaHold) Model.dropSchemaHold(modelFileId)
        if (model) {
          logger(`Created/cached Model instance for modelFileId "${modelFileId}"`)
        }
      } catch (error) {
        logger(`Error creating Model instance for modelFileId "${modelFileId}": ${error}`)
      }
    })
    
    await Promise.all(createPromises)
    logger(`Finished creating/caching ${modelIds.length} Model instances`)
  } catch (error) {
    logger(`Error in createModelInstances: ${error}`)
  }
}

/**
 * Loads the schema named `schemaName` (or with that file id): its row, drafts first, resolved by
 * resolveSchemaRow. With no row, a version file of that name is applied first. Sends
 * `schemaNotFound` only when neither exists, and `loadError` when loading failed, so a failed
 * load never becomes a create over the existing row.
 */
export const checkExistingSchema = fromCallback<
  EventObject,
  FromCallbackInput<SchemaMachineContext>
>(({ sendBack, input: { context } }) => {
  const evictionEpoch = currentEvictionEpoch()
  const _check = async (): Promise<void> => {
    const { schemaName } = context
    const db = BaseDb.getAppDb()
    if (!schemaName || !db) {
      sendBack({ type: 'schemaNotFound' })
      return
    }

    const findRow = async () => {
      if (schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
        const [internal] = await db.select().from(schemas).where(eq(schemas.schemaFileId, INTERNAL_SCHEMA_IDS[0])).limit(1)
        if (internal) return internal
      }
      const [byName] = await db
        .select()
        .from(schemas)
        .where(eq(schemas.name, schemaName))
        .orderBy(desc(schemas.isDraft), desc(schemas.version))
        .limit(1)
      if (byName) return byName
      const [byFileId] = await db.select().from(schemas).where(eq(schemas.schemaFileId, schemaName)).limit(1)
      return byFileId
    }

    let row = await findRow()
    if (!row) {
      // A version file with no row yet (written by another tool, or before this database)
      const file = (await listLatestSchemaFiles()).find((info) => info.name === schemaName)
      if (!file) {
        sendBack({ type: 'schemaNotFound' })
        return
      }
      const schemaFile = await readSchemaFile(file.filePath)
      if (!schemaFile) throw new Error(`Could not read schema file ${file.filePath}`)
      await applySchemaFile({ ...schemaFile, id: schemaFile.id ?? file.schemaFileId }, { store: false })
      row = await findRow()
      if (!row) throw new Error(`Schema "${schemaName}" has no row after applying ${file.filePath}`)
    }
    logger(`Found schema record: name="${row.name}", isDraft=${row.isDraft}`)

    const { schema } = await resolveSchemaRow(row, db)
    const modelIds = row.id ? await getModelIdsForSchema(row.id) : []
    await createModelInstances(modelIds, evictionEpoch)

    const loadedAt = Date.now()
    sendBack({
      type: 'schemaFound',
      schema,
      schemaRecord: row,
      modelIds,
      loadedAt,
      dbVersion: row.version || schema.version,
      dbUpdatedAt: row.updatedAt || loadedAt,
    })
  }

  _check().catch((error) => {
    logger('Error in checkExistingSchema:', error)
    sendBack({ type: 'loadError', error: error instanceof Error ? error : new Error(String(error)) })
  })

  return () => {}
})
