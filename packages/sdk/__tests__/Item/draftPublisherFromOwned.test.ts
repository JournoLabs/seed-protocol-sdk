/**
 * Batch 8 N1: with owned addresses set and nothing supplying a publisher (a Node script with no
 * getter), new drafts had no publisher and so were read-only: edits were refused. With exactly one
 * owned address, a new draft is now that address's.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { waitFor } from 'xstate'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { generateId } from '@/helpers'
import { importJsonSchema } from '@/imports/json'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const OWNER = '0x' + '3'.repeat(40)
const SMART = '0x' + '4'.repeat(40)

testDescribe('new drafts and owned addresses', () => {
  const schemaName = 'Test Schema Draft Publisher'

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema(
      {
        contents: JSON.stringify({
          $schema: 'https://seedprotocol.org/schemas/data-model/v1',
          version: 1,
          id: 'test-schema-draft-publisher',
          metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          models: { Note: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } } },
          enums: {},
          migrations: [],
        }),
      },
      1,
    )
    const model = Model.create('Note', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [], watched: [] })
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const publisherOf = async (seedLocalId: string) => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const [row] = await BaseDb.getAppDb().select().from(seeds).where(eq(seeds.localId, seedLocalId))
    return row?.publisher ?? null
  }

  it('with one owned address, a new draft is that address and stays editable', async () => {
    const { client } = await import('@/client')
    const { isItemOwned } = await import('@/helpers/ownership')
    await client.setAddresses({ owned: [OWNER], watched: [] })

    const item = await Item.create({ modelName: 'Note', schemaName, title: 'first' } as never)
    expect((await publisherOf(item.seedLocalId!))?.toLowerCase()).toBe(OWNER)
    expect(await isItemOwned(item)).toBe(true)
  })

  it("with several owned addresses, which one publishes isn't known: no publisher", async () => {
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [OWNER, SMART], watched: [] })

    const item = await Item.create({ modelName: 'Note', schemaName } as never)
    expect(await publisherOf(item.seedLocalId!)).toBeNull()
  })
})
