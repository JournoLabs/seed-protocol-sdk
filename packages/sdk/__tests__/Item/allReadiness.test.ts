import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Item.all takes `waitForReady` (default false) and `readyTimeout`. With waitForReady false it must
 * hand back the instances without waiting for each one to load; with true it waits, within
 * readyTimeout. Item.all builds each instance with Item.create, whose own waitForReady defaults to
 * true, so Item.all creates them with waitForReady false and does its own wait.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Item All Readiness'
const MODEL_NAME = 'ReadinessPost'
const ITEM_COUNT = 3

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      [MODEL_NAME]: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

testDescribe('Item.all readiness options', () => {
  const seedLocalIds: string[] = []

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    for (let i = 0; i < ITEM_COUNT; i++) {
      const item = await Item.create({ modelName: MODEL_NAME, schemaName: SCHEMA_NAME, title: `post ${i}` } as never)
      seedLocalIds.push(item.seedLocalId)
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    vi.restoreAllMocks()
    // Each test loads the items fresh from the DB, not from the instances an earlier test cached.
    Item.dropCachedInstancesForSeedIds(seedLocalIds)
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  /** The options Item.all passed to Item.create, one entry per item. */
  const createOptionsDuring = async (run: () => Promise<Item<any>[]>) => {
    Item.dropCachedInstancesForSeedIds(seedLocalIds)
    const create = vi.spyOn(Item, 'create')
    const items = await run()
    const options = create.mock.calls.map(([, opts]) => opts)
    create.mockRestore()
    return { items, options }
  }

  it('waitForReady: false builds each item without waiting for it to load', async () => {
    const { items, options } = await createOptionsDuring(() =>
      Item.all(MODEL_NAME, false, { schemaName: SCHEMA_NAME, waitForReady: false }),
    )

    expect(items).toHaveLength(ITEM_COUNT)
    expect(options).toHaveLength(ITEM_COUNT)
    for (const opts of options) {
      expect(opts?.waitForReady).toBe(false)
    }
  }, 30000)

  it('the default is waitForReady: false', async () => {
    const { items, options } = await createOptionsDuring(() => Item.all(MODEL_NAME, false, { schemaName: SCHEMA_NAME }))

    expect(items).toHaveLength(ITEM_COUNT)
    for (const opts of options) {
      expect(opts?.waitForReady).toBe(false)
    }
  }, 30000)

  it('waitForReady: true returns every item ready', async () => {
    const items = await Item.all(MODEL_NAME, false, { schemaName: SCHEMA_NAME, waitForReady: true })

    expect(items).toHaveLength(ITEM_COUNT)
    for (const item of items) {
      expect(Item.peekReady(item.seedLocalId)).toBe(item)
    }
  }, 30000)
})
