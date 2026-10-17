import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { Model } from '@/Model/Model'
import { SEED_PROTOCOL_SCHEMA_NAME } from '@/helpers/constants'
import internalSchema from '@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json'
import { createTestConfig, initializeTestClient, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

type Driver = (sql: string, params: unknown[], method: string) => Promise<unknown>

// A fresh init imports the Seed Protocol schema: addModelsToDb writes its models and properties, and the
// Model instances the import creates adopt those rows. Each row is inserted once and not rewritten by a
// second writer. The test inits against its own filesDir, so the database starts empty.
describe('fresh init writes each Seed Protocol model and property row once', () => {
  const filesDir = `/fresh-init-${Math.random().toString(36).slice(2, 10)}`
  const writes: { sql: string; params: unknown[] }[] = []
  const originalPrepareDb = BaseDb.prepareDb

  beforeAll(async () => {
    // The database stays open until the page goes away, so remove earlier runs' directories here
    const root = await navigator.storage.getDirectory()
    const leftovers: string[] = []
    for await (const name of (root as any).keys() as AsyncIterable<string>) {
      if (name.startsWith('fresh-init-')) leftovers.push(name)
    }
    for (const name of leftovers) await root.removeEntry(name, { recursive: true }).catch(() => {})
    // Wrap the driver as soon as the database exists, before init imports the schema
    BaseDb.prepareDb = async (...args: Parameters<typeof BaseDb.prepareDb>) => {
      const result = await originalPrepareDb.apply(BaseDb, args)
      const session = (BaseDb.getAppDb() as any).session as { client: Driver }
      const client = session.client
      session.client = async (sql, params, method) => {
        if (/^(insert into|update) /.test(sql)) writes.push({ sql, params })
        return client(sql, params, method)
      }
      return result
    }
    await initializeTestClient({
      config: createTestConfig({
        config: { endpoints: { filePaths: '/api/seed/migrations', files: filesDir } } as any,
      }),
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    BaseDb.prepareDb = originalPrepareDb
  })

  const writesTo = (table: string, fileId: string) =>
    writes
      .filter(({ sql, params }) => sql.includes(` "${table}" `) && params.includes(fileId))
      .map(({ sql }) => sql.split(' (')[0].split(' set ')[0])

  it('inserts each row once', async () => {
    const models = Object.entries(internalSchema.models) as [string, { id: string; properties: Record<string, { id: string }> }][]
    // Resolves once each model has created its properties
    for (const [modelName, { id }] of models) {
      await Model.create(modelName, SEED_PROTOCOL_SCHEMA_NAME, { modelFileId: id })
    }
    // Writes that would duplicate these can trail the models becoming ready
    await new Promise((resolve) => setTimeout(resolve, 500))

    for (const [, model] of models) {
      expect(writesTo('models', model.id)).toEqual(['insert into "models"'])
      for (const property of Object.values(model.properties)) {
        expect(writesTo('properties', property.id)).toEqual(['insert into "properties"'])
      }
    }
  })
})
