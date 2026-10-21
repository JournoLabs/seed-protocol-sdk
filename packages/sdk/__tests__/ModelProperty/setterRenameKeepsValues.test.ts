// Defect 1.3 (SDK audit V6): a ModelProperty setter rename left the item's value under the old
// name. Readers match metadata rows by property_id (decision D4), so the rename is a properties row
// update and the value reads under the new name.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'
import { waitForItemIdle, waitForModelPropertyIdle, waitForModelSettled } from '../test-utils/waitForIdle'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

const SCHEMA_ID = 'setter-rename-schema'
const SCHEMA_NAME = 'Setter Rename Keeps Values'
const MODEL_ID = 'setter-rename-story'
const TITLE_ID = 'setter-rename-story-title'

testDescribe('ModelProperty setter rename', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)
  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('keeps item values, read under the new name after a reload', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema/MetadataSchema')
    const { properties } = await import('@/seedSchema/ModelSchema')
    const { Schema } = await import('@/Schema/Schema')
    const { Model } = await import('@/Model/Model')
    const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
    const { Item } = await import('@/Item/Item')
    const db = BaseDb.getAppDb()!
    const file = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: SCHEMA_ID,
      metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: { SetterStory: { id: MODEL_ID, properties: { title: { id: TITLE_ID, type: 'Text' } } } },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(file) }, 1)
    const model = await Model.create('SetterStory', SCHEMA_NAME, { modelFileId: MODEL_ID })
    await waitForModelSettled(model as any)

    const item = await Item.create({ modelName: 'SetterStory', schemaName: SCHEMA_NAME, title: 'Kept' } as any)
    await waitForItemIdle(item as any)
    const seedLocalId = item.seedLocalId
    const propRow = async () => (await db.select().from(properties).where(eq(properties.schemaFileId, TITLE_ID)))[0]
    const valueRow = async () =>
      (await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))).find((r) => r.propertyValue === 'Kept')
    await vi.waitFor(async () => expect(await valueRow()).toBeDefined(), { timeout: WAIT_TIMEOUT_MS })
    const { id: titlePropertyId } = await propRow()
    expect((await valueRow())!.propertyId).toBe(titlePropertyId)

    const prop = ModelProperty.getById(TITLE_ID)!
    expect(prop).toBeDefined()
    ;(prop as any).name = 'heading'
    await waitForModelPropertyIdle(prop as any)
    await vi.waitFor(async () => expect((await propRow()).name).toBe('heading'), { timeout: WAIT_TIMEOUT_MS })

    const schema = (await Schema.create(SCHEMA_NAME)) as any
    await schema.saveNewVersion()

    // The properties row was renamed in place; the value row is the same row, still linked by id
    expect((await propRow()).id).toBe(titlePropertyId)
    expect((await valueRow())!.propertyId).toBe(titlePropertyId)

    Item.dropCachedInstancesForSeedIds([seedLocalId])
    Schema.evict(SCHEMA_NAME)
    ModelProperty.evictForModels(Model.evictForSchema(SCHEMA_NAME), SCHEMA_NAME)

    const found = (await Item.find({ seedLocalId, modelName: 'SetterStory' })) as any
    expect(found).toBeDefined()
    await waitForItemIdle(found)
    await vi.waitFor(() => expect(found.heading).toBe('Kept'), { timeout: WAIT_TIMEOUT_MS })
    expect(found.title).toBeUndefined()

    // An edit under the new name writes the same property's row
    found.heading = 'Edited'
    await vi.waitFor(
      async () => {
        const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
        expect(rows.filter((r) => r.propertyId === titlePropertyId).map((r) => r.propertyValue)).toContain('Edited')
        expect(rows.some((r) => r.propertyId == null)).toBe(false)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    found.unload?.()
  }, 60_000)
})
