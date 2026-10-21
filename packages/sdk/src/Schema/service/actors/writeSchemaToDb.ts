import { EventObject, fromCallback } from 'xstate'
import { SchemaFileFormat } from '@/types/import'
import { generateId } from '@/helpers'
import { addSchemaToDb } from '@/helpers/db'
import { applySchemaFile, SCHEMA_FILE_FORMAT } from '@/helpers/schemaApply'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas } from '@/seedSchema/SchemaSchema'
import { eq } from 'drizzle-orm'
import debug from 'debug'
import { SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'

const logger = debug('seedSdk:schema:actors:writeSchemaToDb')

export type WriteSchemaToDbInput = {
  schemaName: string
}

/**
 * Creates the schema `checkExistingSchema` found no row or file for: an empty draft (version 1,
 * new id, no models), or the bundled Seed Protocol schema. Refuses when a row of that name exists:
 * that row failed to load, and creating over it would rewrite it.
 */
export const writeSchemaToDb = fromCallback<
  EventObject,
  WriteSchemaToDbInput
>(({ sendBack, input }) => {
  const _write = async (): Promise<void> => {
    const { schemaName } = input
    const db = BaseDb.getAppDb()
    if (!db) throw new Error('Database not available')

    if (schemaName === SEED_PROTOCOL_SCHEMA_NAME) {
      const internalSchema = await import('../../../seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json')
      const { schemaFile, schemaRecord } = await applySchemaFile(internalSchema.default as SchemaFileFormat, {
        store: false,
      })
      sendBack({
        type: 'schemaWritten',
        schemaRecord,
        schema: schemaFile,
        modelIds: Object.values(schemaFile.models).map((model) => model.id),
      })
      return
    }

    const existing = await db.select({ id: schemas.id }).from(schemas).where(eq(schemas.name, schemaName)).limit(1)
    if (existing.length > 0) {
      throw new Error(`Schema "${schemaName}" has a row that could not be loaded; not creating another`)
    }

    const now = new Date().toISOString()
    const schema: SchemaFileFormat = {
      $schema: SCHEMA_FILE_FORMAT,
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: now, updatedAt: now },
      models: {},
      enums: {},
      migrations: [{ version: 1, timestamp: now, description: 'Initial schema', changes: [] }],
    }
    const schemaRecord = await addSchemaToDb(
      {
        name: schemaName,
        version: schema.version,
        createdAt: new Date(now).getTime(),
        updatedAt: new Date(now).getTime(),
      },
      schema.id,
      JSON.stringify(schema, null, 2),
      true, // isDraft
      true, // isEdited: created at runtime
    )
    logger(`Created new draft schema ${schemaName} in database`)
    sendBack({ type: 'schemaWritten', schemaRecord, schema, modelIds: [] })
  }

  _write().catch((error) => {
    logger('Error in writeSchemaToDb:', error)
    sendBack({
      type: 'writeError',
      error: error instanceof Error ? error : new Error(String(error)),
    })
  })

  return () => {}
})
