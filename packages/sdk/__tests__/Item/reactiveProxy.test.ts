import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema/SeedSchema'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Item and Model are wrapped in one reactive proxy each (helpers/reactiveProxy). These cover what
 * the proxy adds on top of the class: model property names on an item, the rules for tracked and
 * read-only names, and Model's `name` alias.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Reactive Proxy'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      ProxyPost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          summary: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('reactive proxies', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = (title: string) =>
    Item.create({ modelName: 'ProxyPost', schemaName: SCHEMA_NAME, title } as never) as Promise<
      Item<any> & { title?: string; summary?: string }
    >

  it("reads and writes the model's properties by name", async () => {
    const item = await createPost('first')
    expect(item.title).toBe('first')
    expect('title' in item).toBe(true)
    expect(Object.keys(item)).toEqual(expect.arrayContaining(['title', 'summary']))

    item.summary = 'set through the proxy'
    expect(item.summary).toBe('set through the proxy')
    expect(item.properties.find((p) => p.propertyName === 'summary')?.value).toBe('set through the proxy')
    item.unload()
  }, 30000)

  it('refuses publisher and properties assignments', async () => {
    const item = await createPost('read-only')
    expect(() => {
      ;(item as any).publisher = '0x' + '1'.repeat(40)
    }).toThrow(/publisher is read-only/)
    expect(() => {
      ;(item as any).properties = []
    }).toThrow(/Cannot set item.properties/)
    item.unload()
  }, 30000)

  it('persists a seed uid assigned to a new draft', async () => {
    const item = await createPost('seed uid')
    const seedUid = '0x' + 'ab'.repeat(32)
    item.seedUid = seedUid
    expect(item.seedUid).toBe(seedUid)

    const db = BaseDb.getAppDb()!
    await vi.waitFor(
      async () => {
        const [row] = await db.select({ uid: seeds.uid }).from(seeds).where(eq(seeds.localId, item.seedLocalId))
        expect(row?.uid).toBe(seedUid)
      },
      { timeout: 10000 },
    )
    item.unload()
  }, 30000)

  it("Model's name aliases modelName, and properties and description are read-only", async () => {
    const [model] = await Model.all(SCHEMA_NAME, { waitForReady: true })
    expect(model.name).toBe(model.modelName)
    expect(Object.keys(model)).toContain('name')
    expect(() => {
      ;(model as any).properties = []
    }).toThrow(/Cannot set model.properties/)
    expect(() => {
      ;(model as any).description = 'nope'
    }).toThrow(/Cannot set model.description/)
  }, 30000)
})
