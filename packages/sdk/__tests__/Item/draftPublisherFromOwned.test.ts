/**
 * Batch 8 N1: with owned addresses set and nothing supplying a publisher (a Node script with no
 * getter), new drafts had no publisher and so were read-only: edits were refused. With exactly one
 * owned address, a new draft is now that address's. With several it has none, stays editable, and
 * the next wallet to connect claims it with its versions and property rows.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { waitFor } from 'xstate'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
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
          $schema: 'https://seedprotocol.io/schemas/data-model/v1',
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
    await model.waitForReady({ timeout: WAIT_TIMEOUT_MS })
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

  const rowPublishers = async (seedLocalId: string) => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata, versions } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const db = BaseDb.getAppDb()
    const versionRows = await db.select({ publisher: versions.publisher }).from(versions).where(eq(versions.seedLocalId, seedLocalId))
    const propertyRows = await db
      .select({ publisher: metadata.publisher, value: metadata.propertyValue })
      .from(metadata)
      .where(eq(metadata.seedLocalId, seedLocalId))
    return { versionRows, propertyRows }
  }

  const editTitle = async (seedLocalId: string, value: string) => {
    const property = await ItemProperty.find({ seedLocalId, propertyName: 'title' })
    property!.value = value
    await vi.waitFor(async () => {
      const { propertyRows } = await rowPublishers(seedLocalId)
      expect(propertyRows.map((row: { value: string | null }) => row.value)).toContain(value)
    })
    expect(property!.getService().getSnapshot().context._saveError ?? null).toBeNull()
  }

  it('a draft with no publisher is editable, and the next connection claims it with its rows', async () => {
    const { client } = await import('@/client')
    const { isItemOwned } = await import('@/helpers/ownership')
    await client.setAddresses({ owned: [OWNER, SMART], watched: [] })

    const item = await Item.create({ modelName: 'Note', schemaName, title: 'unconnected' } as never)
    expect(await isItemOwned(item)).toBe(true)
    await editTitle(item.seedLocalId!, 'edited before connecting')

    await client.claimUnpublishedDrafts(SMART)
    expect(await publisherOf(item.seedLocalId!)).toBe(SMART)
    const { versionRows, propertyRows } = await rowPublishers(item.seedLocalId!)
    expect(versionRows.map((row: { publisher: string | null }) => row.publisher)).toEqual(versionRows.map(() => SMART))
    expect(propertyRows.map((row: { publisher: string | null }) => row.publisher)).toEqual(propertyRows.map(() => SMART))
  }, 30000)

  it('claiming a loaded draft adds no hold: one unload stops it', async () => {
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [OWNER, SMART], watched: [] })

    const item = await Item.create({ modelName: 'Note', schemaName, title: 'claimed then unloaded' } as never)
    await client.claimUnpublishedDrafts(SMART)
    expect(item.getService().getSnapshot().context.publisher?.toLowerCase()).toBe(SMART)

    item.unload()
    expect(item.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  it("an edit's rows take the seed's publisher, so another wallet's claim leaves them alone", async () => {
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [OWNER], watched: [] })

    const item = await Item.create({ modelName: 'Note', schemaName, title: 'mine' } as never)
    await editTitle(item.seedLocalId!, 'edited by owner')

    // Another wallet connects and claims what belongs to no wallet.
    await client.setAddresses({ owned: [SMART], watched: [] })
    await client.claimUnpublishedDrafts(SMART)

    expect(await publisherOf(item.seedLocalId!)).toBe(OWNER)
    const { versionRows, propertyRows } = await rowPublishers(item.seedLocalId!)
    expect(versionRows.map((row: { publisher: string | null }) => row.publisher)).toEqual(versionRows.map(() => OWNER))
    expect(propertyRows.map((row: { publisher: string | null }) => row.publisher)).toEqual(propertyRows.map(() => OWNER))
  }, 30000)
})
