import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { createNewItem } from '@/db/write/createNewItem'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * Item.find for an item that isn't loaded: by seedLocalId it looks up the local id first, and an id
 * passed as seedLocalId that is really a uid is still found.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const schemaName = 'Find Uncached By Id'
const testSchema: SchemaFileFormat = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: 'find-uncached-by-id',
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    FindByIdNote: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        count: { id: generateId(), type: 'Number' },
      },
    },
  },
  enums: {},
  migrations: [],
}

testDescribe('Item.find for an item not loaded', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    const model = Model.create('FindByIdNote', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('finds it by seedLocalId with its stored values', async () => {
    const { seedLocalId } = await createNewItem({ modelName: 'FindByIdNote', title: 'By local id', count: 3 } as never)
    const found = (await Item.find({ modelName: 'FindByIdNote', seedLocalId })) as Item<any> | undefined
    try {
      expect(found?.seedLocalId).toBe(seedLocalId)
      expect(found?.properties.find((p) => p.propertyName === 'title')?.value).toBe('By local id')
    } finally {
      found?.unload()
    }
  })

  it('finds it when its uid is passed as seedLocalId', async () => {
    const { seedLocalId } = await createNewItem({ modelName: 'FindByIdNote', title: 'By uid' } as never)
    const uid = `0x${'ab'.repeat(32)}`
    await BaseDb.getAppDb().update(seeds).set({ uid }).where(eq(seeds.localId, seedLocalId))
    const found = (await Item.find({ modelName: 'FindByIdNote', seedLocalId: uid })) as Item<any> | undefined
    try {
      expect(found?.seedLocalId).toBe(seedLocalId)
    } finally {
      found?.unload()
    }
  })

  it('returns undefined for an id nothing has', async () => {
    expect(await Item.find({ modelName: 'FindByIdNote', seedLocalId: generateId() })).toBeUndefined()
  })
})
