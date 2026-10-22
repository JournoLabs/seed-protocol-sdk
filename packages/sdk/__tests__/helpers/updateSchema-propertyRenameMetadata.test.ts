// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { eq } from 'drizzle-orm'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { renameModelProperty, whenDeferredSchemaReloadsSettled } from '@/helpers/updateSchema'
import { models as modelsTable, properties } from '@/seedSchema/ModelSchema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForItemIdle } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

function createTestSchema(name: string, models: Record<string, any>): SchemaFileFormat {
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: {
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models,
    enums: {},
    migrations: [],
  }
}

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('Property Rename Metadata Migration', () => {
  const schemaName = 'Property Rename Test Schema'
  const featureImageId = generateId()

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(metadata)
      const { seeds } = await import('@/seedSchema/SeedSchema')
      const { versions } = await import('@/seedSchema/VersionSchema')
      const { properties } = await import('@/seedSchema/ModelSchema')
      const { modelSchemas } = await import('@/seedSchema/ModelSchemaSchema')
      const { models } = await import('@/seedSchema/ModelSchema')
      const { schemas } = await import('@/seedSchema/SchemaSchema')
      await db.delete(versions)
      await db.delete(seeds)
      await db.update(properties).set({ refModelId: null })
      const { propertyUids } = await import('@/seedSchema/PropertyUidSchema')
      const { modelUids } = await import('@/seedSchema/ModelUidSchema')
      await db.delete(propertyUids)
      await db.delete(modelUids)
      await db.delete(properties)
      await db.delete(modelSchemas)
      await db.delete(models)
      await db.delete(schemas)
    }
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('keeps item values readable under the new name after a rename', async () => {
    const testSchema = createTestSchema(schemaName, {
      Post: {
        id: generateId(),
        properties: {
          featureImage: {
            id: featureImageId,
            dataType: 'Text',
          },
        },
      },
    })

    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

    const model = Model.create('Post', schemaName, { waitForReady: false })
    await model.waitForReady({ timeout: WAIT_TIMEOUT_MS })

    const item = await Item.create({
      modelName: 'Post',
      schemaName,
      featureImage: 'test-value',
    })
    await waitForItemIdle(item)

    const seedLocalId = item.seedLocalId
    expect(seedLocalId).toBeDefined()

    const db = BaseDb.getAppDb()
    if (!db) throw new Error('Database not available')

    const metadataBeforeRename = await db
      .select()
      .from(metadata)
      .where(eq(metadata.seedLocalId, seedLocalId!))
    expect(metadataBeforeRename.length).toBeGreaterThanOrEqual(1)
    const featureImageMeta = metadataBeforeRename.find((m) => m.propertyName === 'featureImage')
    expect(featureImageMeta).toBeDefined()
    expect(featureImageMeta?.propertyValue).toBe('test-value')

    await renameModelProperty(schemaName, 'Post', 'featureImage', 'coverImage')

    // renameModelProperty defers its schema reload (the property row rename); wait for it.
    await whenDeferredSchemaReloadsSettled()

    // The value row needs no move: it stays linked to the property by property_id (decision D4)
    const metadataAfterRename = await db
      .select()
      .from(metadata)
      .where(eq(metadata.seedLocalId, seedLocalId!))
    const valueRows = metadataAfterRename.filter((m) => m.propertyValue === 'test-value')
    expect(valueRows).toHaveLength(1)
    expect(valueRows[0].propertyId).toBe(featureImageMeta!.propertyId)
    const [propertyRow] = await db.select().from(properties).where(eq(properties.id, featureImageMeta!.propertyId!))
    expect(propertyRow?.name).toBe('coverImage')

    item.unload?.()

    const loadedItem = await Item.find({
      modelName: 'Post',
      seedLocalId: seedLocalId!,
    })
    expect(loadedItem).toBeDefined()
    await waitForItemIdle(loadedItem!)

    expect(loadedItem!.coverImage).toBe('test-value')
    expect(loadedItem!.featureImage).toBeUndefined()
  })

  it('should rename the property row in place when the schema reloads after a rename', async () => {
    // Own schema name: the first test leaves its v2 schema file on disk
    const renameSchemaName = 'Property Rename Row Test Schema'
    // Own property id too, so ModelProperty.getById can't return the first test's cached instance
    const propertyFileId = generateId()
    const testSchema = createTestSchema(renameSchemaName, {
      Post: {
        id: generateId(),
        properties: {
          featureImage: {
            id: propertyFileId,
            dataType: 'Text',
          },
        },
      },
    })

    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)

    const db = BaseDb.getAppDb()
    if (!db) throw new Error('Database not available')

    const [postModel] = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.schemaFileId, testSchema.models.Post.id!))
    expect(postModel).toBeDefined()

    const propertiesBefore = await db
      .select()
      .from(properties)
      .where(eq(properties.modelId, postModel.id!))
    const featureImageRow = propertiesBefore.find((p) => p.name === 'featureImage')
    expect(featureImageRow).toBeDefined()

    await renameModelProperty(renameSchemaName, 'Post', 'featureImage', 'coverImage')
    await whenDeferredSchemaReloadsSettled()

    const propertiesAfter = await db
      .select()
      .from(properties)
      .where(eq(properties.modelId, postModel.id!))

    expect(propertiesAfter.map((p) => p.name)).toEqual(['coverImage'])
    expect(propertiesAfter[0].id).toBe(featureImageRow!.id)
    expect(propertiesAfter[0].schemaFileId).toBe(propertyFileId)

    // The cached instance follows the renamed row
    const cachedProperty = ModelProperty.getById(propertyFileId)
    expect(cachedProperty).toBeDefined()
    expect(cachedProperty!.name).toBe('coverImage')
  })
})
