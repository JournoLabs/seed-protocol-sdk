/**
 * ADR 0008 §5: importing a schema treats a property as renamed only when its id matches, and moves
 * its values to the new name. A removed property and an added one of the same type are an add and
 * a remove, not a rename.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const SCHEMA_ID = 'rename-by-id-schema'
const MODEL_ID = 'rename-by-id-story'
const schemaFile = (version: number, properties: Record<string, { id: string; type: string }>) =>
  JSON.stringify({
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version,
    id: SCHEMA_ID,
    metadata: { name: 'Rename By Id', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: { RenameStory: { id: MODEL_ID, properties } },
    enums: {},
    migrations: [],
  })

testDescribe('schema import renames (ADR 0008)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const propertyRow = async (name: string) => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { properties, models } = await import('@/seedSchema')
    const rows = await BaseDb.getAppDb()
      .select({ id: properties.id, name: properties.name, schemaFileId: properties.schemaFileId })
      .from(properties)
      .innerJoin(models, eq(models.id, properties.modelId))
      .where(and(eq(models.schemaFileId, MODEL_ID), eq(properties.name, name)))
    return rows[0]
  }

  const waitForProperty = async (name: string) => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const row = await propertyRow(name)
      if (row) return row
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`property ${name} was not stored`)
  }

  it('moves values when the id matches, and adds instead of guessing when it does not', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata } = await import('@/seedSchema')
    const appDb = BaseDb.getAppDb()

    await importJsonSchema({ contents: schemaFile(1, { headline: { id: 'prop-headline', type: 'Text' } }) }, 1)
    const headline = await waitForProperty('headline')
    await appDb.insert(metadata).values({
      localId: 'rename-by-id-value',
      seedLocalId: 'rename-by-id-seed',
      propertyId: headline.id,
      propertyName: 'headline',
      propertyValue: 'Kept',
      modelType: 'rename_story',
      createdAt: Date.now(),
    })

    // Same id, new key: a rename.
    await importJsonSchema({ contents: schemaFile(2, { title: { id: 'prop-headline', type: 'Text' } }) }, 2)
    const title = await waitForProperty('title')
    expect(title.id).toBe(headline.id)
    // The row needs no move: it stays linked to the renamed property by property_id (decision D4)
    const [moved] = await appDb.select().from(metadata).where(eq(metadata.localId, 'rename-by-id-value'))
    expect(moved.propertyId).toBe(title.id)
    expect(moved.propertyName).toBe('headline')

    // Title removed and an unrelated Text property added: not a rename.
    await importJsonSchema({ contents: schemaFile(3, { summary: { id: 'prop-summary', type: 'Text' } }) }, 3)
    const summary = await waitForProperty('summary')
    expect(summary.id).not.toBe(headline.id)
    const [kept] = await appDb.select().from(metadata).where(eq(metadata.localId, 'rename-by-id-value'))
    expect(kept.propertyId).not.toBe(summary.id)
    expect(kept.propertyName).toBe('headline')
  })
})
