import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/** Item machine context updates: what updateContext keeps, and when updateProperties stamps. */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Item Machine Context'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: { ContextPost: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } } },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('Item machine context', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = () =>
    Item.create({ modelName: 'ContextPost', schemaName: SCHEMA_NAME, title: 'context' } as never)

  it('updateContext keeps keys the context does not have yet', async () => {
    // Not waiting: revokedAt sent before loading finishes, while the context has no such key
    const item = (await Item.create(
      { modelName: 'ContextPost', schemaName: SCHEMA_NAME, title: 'early' } as never,
      { waitForReady: false },
    )) as Item<any>
    const service = item.getService()
    expect('revokedAt' in service.getSnapshot().context).toBe(false)

    service.send({ type: 'updateContext', revokedAt: 123 } as never)

    expect((service.getSnapshot().context as { revokedAt?: number }).revokedAt).toBe(123)
    item.unload()
  }, 30000)

  it('updateProperties stamps the time of each update', async () => {
    const item = await createPost()
    const service = item.getService()
    const stamp = () => (service.getSnapshot().context as { propertiesUpdatedAt?: number }).propertiesUpdatedAt

    const before = Date.now()
    service.send({ type: 'updateProperties' } as never)
    const first = stamp()
    expect(first).toBeGreaterThanOrEqual(before)

    await new Promise((resolve) => setTimeout(resolve, 5))
    service.send({ type: 'updateProperties' } as never)
    expect(stamp()).toBeGreaterThan(first!)
    item.unload()
  }, 30000)
})
