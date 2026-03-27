// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { eq } from 'drizzle-orm'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { renameModelProperty } from '@/helpers/updateSchema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'

async function waitForItemIdle(item: Item<any>, timeout = 5000): Promise<void> {
  const service = item.getService()
  await waitFor(
    service,
    (snapshot) => {
      if (snapshot.value === 'error') throw new Error('Item failed to load')
      return snapshot.value === 'idle'
    },
    { timeout },
  )
}

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
      timeout: 60000,
    })
  }, 60000)

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

  it('should migrate metadata when property is renamed, preventing duplicate ItemProperties', async () => {
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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({
      modelName: 'Post',
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

    await new Promise((r) => setTimeout(r, 250))

    const metadataAfterRename = await db
      .select()
      .from(metadata)
      .where(eq(metadata.seedLocalId, seedLocalId!))

    const coverImageMeta = metadataAfterRename.filter((m) => m.propertyName === 'coverImage')
    const featureImageMetaAfter = metadataAfterRename.filter((m) => m.propertyName === 'featureImage')

    expect(coverImageMeta.length).toBe(1)
    expect(coverImageMeta[0].propertyValue).toBe('test-value')
    expect(featureImageMetaAfter.length).toBe(0)

    item.unload?.()

    const loadedItem = await Item.find({
      modelName: 'Post',
      seedLocalId: seedLocalId!,
    })
    expect(loadedItem).toBeDefined()
    await waitForItemIdle(loadedItem!)

    expect(loadedItem!.coverImage).toBe('test-value')
  })
})
