import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'
import { properties as propertiesTable } from '@/seedSchema/ModelSchema'
import internalSchema from '@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json'
import { createTestConfig, initializeTestClient, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

type Driver = (sql: string, params: unknown[], method: string) => Promise<unknown>

// Loading a model from rows that already exist (a second init, a cold Model.createById) must not write
// them. Each load used to issue one UPDATE per property row with is_edited = false, so an unsaved
// definition edit lost its edit flag (audit 1.6).
describe('loading models does not rewrite property rows', () => {
  const filesDir = `/load-no-rewrite-${Math.random().toString(36).slice(2, 10)}`
  const config = () =>
    createTestConfig({ config: { endpoints: { filePaths: '/api/seed/migrations', files: filesDir } } as any })
  const writes: { sql: string; params: unknown[] }[] = []
  const wrapped = new WeakSet<object>()
  const originalPrepareDb = BaseDb.prepareDb

  // Each init opens a new session: wrap its driver to record writes
  const wrapCurrentSession = () => {
    const session = (BaseDb.getAppDb() as any).session as { client: Driver }
    if (wrapped.has(session)) return
    wrapped.add(session)
    const client = session.client
    session.client = async (sql, params, method) => {
      if (/^(insert into|update|delete from) /.test(sql)) writes.push({ sql, params })
      return client(sql, params, method)
    }
  }

  const propertyUpdates = (fileIds: string[]) =>
    writes.filter(({ sql, params }) => sql.startsWith('update "properties"') && fileIds.some((id) => params.includes(id)))

  const setEdited = (fileId: string) =>
    BaseDb.getAppDb()!.update(propertiesTable).set({ isEdited: true }).where(eq(propertiesTable.schemaFileId, fileId))

  const isEdited = async (fileId: string) => {
    const [row] = await BaseDb.getAppDb()!
      .select({ isEdited: propertiesTable.isEdited })
      .from(propertiesTable)
      .where(eq(propertiesTable.schemaFileId, fileId))
    return row?.isEdited
  }

  // Stand-in for a page reload, which the test runner can't do
  const evictSchema = (name: string) => {
    Schema.evict(name)
    ModelProperty.evictForModels(Model.evictForSchema(name), name)
  }

  beforeAll(async () => {
    // The database stays open until the page goes away, so remove earlier runs' directories here
    const root = await navigator.storage.getDirectory()
    const leftovers: string[] = []
    for await (const name of (root as any).keys() as AsyncIterable<string>) {
      if (name.startsWith('load-no-rewrite-')) leftovers.push(name)
    }
    for (const name of leftovers) await root.removeEntry(name, { recursive: true }).catch(() => {})
    BaseDb.prepareDb = async (...args: Parameters<typeof BaseDb.prepareDb>) => {
      const result = await originalPrepareDb.apply(BaseDb, args)
      wrapCurrentSession()
      return result
    }
    await initializeTestClient({ config: config(), timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS * 2)

  afterAll(() => {
    BaseDb.prepareDb = originalPrepareDb
  })

  it('a second init on the same filesDir', async () => {
    const models = Object.entries(internalSchema.models) as [
      string,
      { id: string; properties: Record<string, { id: string }> },
    ][]
    const propertyIds = models.flatMap(([, model]) => Object.values(model.properties).map(({ id }) => id))
    for (const [modelName, { id }] of models) {
      await Model.create(modelName, SEED_PROTOCOL_SCHEMA_NAME, { modelFileId: id })
    }
    // Writes can trail the models becoming ready
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const edited = propertyIds[0]
    await setEdited(edited)

    const { client } = await import('@/client')
    client.stop()
    evictSchema(SEED_PROTOCOL_SCHEMA_NAME)
    writes.length = 0

    await initializeTestClient({ config: config(), timeout: SETUP_HOOK_TIMEOUT_MS })
    wrapCurrentSession()
    for (const [modelName, { id }] of models) {
      await Model.create(modelName, SEED_PROTOCOL_SCHEMA_NAME, { modelFileId: id })
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(propertyUpdates(propertyIds)).toEqual([])
    expect(await isEdited(edited)).toBe(true)
  }, 90_000)

  it('a cold Model.createById after an import', async () => {
    const schemaName = `Load No Rewrite ${generateId()}`
    const noteId = generateId()
    const titleId = generateId()
    const bodyId = generateId()
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Note: { id: noteId, properties: { title: { id: titleId, type: 'Text' }, body: { id: bodyId, type: 'Text' } } },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    await Model.create('Note', schemaName, { modelFileId: noteId })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await setEdited(titleId)

    evictSchema(schemaName)
    writes.length = 0
    expect(await Model.createById(noteId)).toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(propertyUpdates([titleId, bodyId])).toEqual([])
    expect(await isEdited(titleId)).toBe(true)
  }, 60_000)
})
