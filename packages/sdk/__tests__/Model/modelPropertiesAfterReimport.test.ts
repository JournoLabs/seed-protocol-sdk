import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

const SCHEMA_NAME = 'Reimport Properties Schema'

// A fresh model id each import, as when a schema file is regenerated and imported again.
const reimportSchema = (): SchemaFileFormat => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'reimport-properties-schema',
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    Article: {
      id: generateId(),
      properties: {
        headline: { id: generateId(), type: 'Text' },
        body: { id: generateId(), type: 'Text' },
      },
    },
  },
  enums: {},
  migrations: [],
})

// Finding 2: after a re-import, the Model instance loaded from the schema file went idle before the
// import wrote its row, so it never resolved its _dbId or set up its properties liveQuery, and
// `model.properties` stayed [] for good.
describe('model.properties after re-importing a schema', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await cleanupTestSchemaData()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await cleanupTestSchemaData()
  })

  for (const round of [1, 2, 3]) {
    it(`lists the model's properties (import ${round})`, async () => {
      await cleanupTestSchemaData()
      await importJsonSchema({ contents: JSON.stringify(reimportSchema()) }, 1)

      const model = await Model.find({ modelName: 'Article', schemaName: SCHEMA_NAME })
      expect(model).toBeDefined()
      await waitUntilOrThrow(
        () => model!.properties.length === 2,
        'model.properties to list headline and body',
        5000,
      )
      expect(model!.properties.map((p) => p.name).sort()).toEqual(['body', 'headline'])
    })
  }
})
