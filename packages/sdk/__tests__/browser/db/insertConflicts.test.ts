import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { savePropertyToDb, writeModelToDb, writePropertyToDb } from '@/helpers/db'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { cleanupTestSchemaData } from '../../test-utils/cleanupTestDb'

type Driver = (sql: string, params: unknown[], method: string) => Promise<unknown>

// The schema import writes each model and property twice at once (addModelsToDb and the Model
// instances' own write), so an insert can find its row already there. A failed statement is logged by
// sqlite-wasm in the DB worker even when the SDK catches it ("sqlite3_step() rc= 2067
// SQLITE_CONSTRAINT_UNIQUE"), so these inserts must not fail. The driver below runs the matching
// insert once before the SDK's own (standing in for the other writer) and records failed statements.
describe('inserts that find their row already written', () => {
  const failures: string[] = []
  let preempt: ((sql: string, params: unknown[]) => boolean) | undefined
  let preempted = false
  let originalClient: Driver

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const session = (BaseDb.getAppDb() as any).session as { client: Driver }
    originalClient = session.client
    session.client = async (sql, params, method) => {
      if (preempt?.(sql, params)) {
        preempt = undefined
        preempted = true
        await originalClient(sql, params, method)
      }
      try {
        return await originalClient(sql, params, method)
      } catch (error) {
        failures.push(`${error instanceof Error ? error.message : String(error)}: ${sql}`)
        throw error
      }
    }
    return () => {
      session.client = originalClient
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    preempt = undefined
    preempted = false
    failures.length = 0
    await cleanupTestSchemaData()
  })

  const insertInto = (table: string, fileId: string) => (sql: string, params: unknown[]) =>
    sql.startsWith(`insert into "${table}"`) && params.includes(fileId)

  const importTestSchema = async (modelId = generateId(), titleId = generateId()) => {
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: {
        name: `Insert Conflicts ${generateId()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      models: { Note: { id: modelId, properties: { title: { id: titleId, type: 'Text' } } } },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    const db = BaseDb.getAppDb()!
    const [schemaRow] = await db
      .select({ id: schemasTable.id })
      .from(schemasTable)
      .where(eq(schemasTable.name, schemaFile.metadata.name))
    const [modelRow] = await db
      .select({ id: modelsTable.id })
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, modelId))
    return { schemaId: schemaRow.id as number, modelRowId: modelRow.id as number }
  }

  const rowsWithFileId = async (table: typeof modelsTable | typeof propertiesTable, fileId: string) =>
    BaseDb.getAppDb()!.select().from(table).where(eq(table.schemaFileId, fileId))

  it('schema import: model already inserted', async () => {
    const modelId = generateId()
    preempt = insertInto('models', modelId)
    await importTestSchema(modelId)
    expect(preempted).toBe(true)
    expect(failures).toEqual([])
    expect(await rowsWithFileId(modelsTable, modelId)).toHaveLength(1)
  })

  it('schema import: property already inserted', async () => {
    const titleId = generateId()
    preempt = insertInto('properties', titleId)
    await importTestSchema(generateId(), titleId)
    expect(preempted).toBe(true)
    expect(failures).toEqual([])
    expect(await rowsWithFileId(propertiesTable, titleId)).toHaveLength(1)
  })

  it('writeModelToDb: model already inserted', async () => {
    const { schemaId } = await importTestSchema()
    const modelFileId = generateId()
    preempt = insertInto('models', modelFileId)
    await writeModelToDb(modelFileId, { modelName: 'Other', schemaId })
    expect(preempted).toBe(true)
    expect(failures).toEqual([])
    expect(await rowsWithFileId(modelsTable, modelFileId)).toHaveLength(1)
  })

  it('writePropertyToDb: property already inserted', async () => {
    const { modelRowId } = await importTestSchema()
    const propertyFileId = generateId()
    preempt = insertInto('properties', propertyFileId)
    await writePropertyToDb(propertyFileId, { modelId: modelRowId, name: 'body', dataType: 'Text' })
    expect(preempted).toBe(true)
    expect(failures).toEqual([])
    expect(await rowsWithFileId(propertiesTable, propertyFileId)).toHaveLength(1)
  })

  it('savePropertyToDb: property already inserted', async () => {
    const { modelRowId } = await importTestSchema()
    const propertyFileId = generateId()
    preempt = insertInto('properties', propertyFileId)
    await savePropertyToDb({
      id: propertyFileId,
      name: 'summary',
      modelId: modelRowId,
      modelName: 'Note',
      dataType: 'Text',
    } as Parameters<typeof savePropertyToDb>[0])
    expect(preempted).toBe(true)
    expect(failures).toEqual([])
    expect(await rowsWithFileId(propertiesTable, propertyFileId)).toHaveLength(1)
  })
})
