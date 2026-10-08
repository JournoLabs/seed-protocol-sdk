/**
 * Integration tests for Image property persistence.
 * Verifies that Blob and blob URL inputs are saved to files and survive reload.
 */
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { metadata } from '@/seedSchema/MetadataSchema'
import { schemas } from '@/seedSchema/SchemaSchema'
import { seeds } from '@/seedSchema/SeedSchema'
import { eq } from 'drizzle-orm'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle, type HasService } from '../test-utils/waitForIdle'

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function createPngBlob(): Blob {
  const binaryString = atob(MINIMAL_PNG_BASE64)
  const binaryArray = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    binaryArray[i] = binaryString.charCodeAt(i)
  }
  return new Blob([binaryArray], { type: 'image/png' })
}

function createPngFile(name: string): File {
  const blob = createPngBlob()
  return new File([blob], name, { type: 'image/png' })
}

const waitForItemIdle = (item: HasService, timeout = 10000) =>
  waitForIdle(item, 'Item', timeout)

const waitForItemPropertyIdle = (property: HasService, timeout = 15000) =>
  waitForIdle(property, 'ItemProperty', timeout)

/**
 * Wait until saveImage has finished: it replaces propertyValue with the image seed id and sets
 * refResolvedValue to the saved filename. Blob/File values get an optimistic refResolvedValue
 * ('image' or the File name) before the save runs, so refResolvedValue alone is not a completion signal.
 */
async function waitForRefResolvedValue(
  property: ItemProperty<any>,
  timeout = 15000
): Promise<string | undefined> {
  const snapshot = await waitFor(
    property.getService(),
    (s) => {
      const ctx = s.context as Record<string, any>
      if (ctx._saveError || ctx._saveValidationErrors?.length) return true
      return (
        !!ctx.refResolvedValue &&
        ctx.refSeedType === 'image' &&
        typeof ctx.propertyValue === 'string' &&
        !/^(blob|data):/.test(ctx.propertyValue)
      )
    },
    { timeout }
  )
  const ctx = snapshot.context as Record<string, any>
  expect(ctx._saveError ?? null).toBeNull()
  expect(ctx._saveValidationErrors ?? []).toEqual([])
  return ctx.refResolvedValue
}

/**
 * Browser: Image values render as blob: URLs. Node has no display blob URLs for saved files
 * (NodeFileManager.getContentUrlFromPath returns file://, d0159c8), so ItemProperty.value
 * falls back to the saved filename.
 */
async function expectImageDisplayValue(
  property: ItemProperty<any>,
  savedFileName: string | undefined
): Promise<void> {
  const renderValue = property.value
  expect(renderValue).toBeTruthy()
  if (typeof window !== 'undefined') {
    expect(typeof renderValue === 'string' && renderValue.startsWith('blob:')).toBe(true)
    return
  }
  expect(renderValue).toBe(savedFileName)
  expect(await BaseFileManager.pathExists(BaseFileManager.getFilesPath('images', renderValue))).toBe(true)
}

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('Image property persistence integration tests', () => {
  const schemaName = 'Test Schema Image Persistence'
  const testSchema: SchemaFileFormat = {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: 'test-schema-image-persistence',
    metadata: {
      name: schemaName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models: {
      Post: {
        id: generateId(),
        properties: {
          title: {
            id: generateId(),
            type: 'Text',
          },
          featureImage: {
            id: generateId(),
            type: 'Image',
          },
        },
      },
    },
    enums: {},
    migrations: [],
  }

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  beforeEach(async () => {
    const db = BaseDb.getAppDb()
    if (db) {
      await db.delete(metadata)
      await db.delete(seeds)
    }
    Schema.clearCache()
  })

  it('saves Blob to file and persists', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post with Blob image' })
    await waitForItemIdle(item)

    const featureImageProperty = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    const blob = createPngBlob()
    featureImageProperty.value = blob

    const refResolvedValue = await waitForRefResolvedValue(featureImageProperty)
    expect(refResolvedValue).toBeTruthy()

    const imagesPath = BaseFileManager.getFilesPath('images')
    const files = await BaseFileManager.listImageFiles()
    expect(files.some((f) => refResolvedValue && f.includes(refResolvedValue))).toBe(true)

    const metaRows = await BaseDb.getAppDb()!
      .select({ refResolvedValue: metadata.refResolvedValue, refResolvedDisplayValue: metadata.refResolvedDisplayValue })
      .from(metadata)
      .where(eq(metadata.seedLocalId, item.seedLocalId!))
    const imageMeta = metaRows.find((r) => r.refResolvedValue?.includes('.png') || r.refResolvedValue)
    expect(imageMeta?.refResolvedValue).toBeTruthy()
    expect(imageMeta?.refResolvedDisplayValue).toBeFalsy()
  })

  it('saves blob URL to file and persists', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post with blob URL image' })
    await waitForItemIdle(item)

    const featureImageProperty = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    const blob = createPngBlob()
    const blobUrl = URL.createObjectURL(blob)
    featureImageProperty.value = blobUrl

    const refResolvedValue = await waitForRefResolvedValue(featureImageProperty)
    expect(refResolvedValue).toBeTruthy()

    const files = await BaseFileManager.listImageFiles()
    expect(files.some((f) => refResolvedValue && f.includes(refResolvedValue))).toBe(true)

    const metaRows = await BaseDb.getAppDb()!
      .select({ refResolvedValue: metadata.refResolvedValue, refResolvedDisplayValue: metadata.refResolvedDisplayValue })
      .from(metadata)
      .where(eq(metadata.seedLocalId, item.seedLocalId!))
    const imageMeta = metaRows.find((r) => r.refResolvedValue?.includes('.png') || r.refResolvedValue)
    expect(imageMeta?.refResolvedValue).toBeTruthy()
    expect(imageMeta?.refResolvedDisplayValue).toBeFalsy()

    URL.revokeObjectURL(blobUrl)
  })

  it('Image displays after reload when saved from Blob', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post for reload test' })
    await waitForItemIdle(item)

    const featureImageProperty = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    featureImageProperty.value = createPngBlob()
    const refResolvedValue = await waitForRefResolvedValue(featureImageProperty)
    expect(refResolvedValue).toBeTruthy()

    const seedLocalId = item.seedLocalId
    item.unload()

    const reloadedItem = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloadedItem).toBeTruthy()
    if (!reloadedItem) return
    await waitForItemIdle(reloadedItem)

    const reloadedProp = reloadedItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(reloadedProp).toBeTruthy()
    if (!reloadedProp) return

    await waitForItemPropertyIdle(reloadedProp)

    await expectImageDisplayValue(reloadedProp, refResolvedValue)
  })

  it('Image displays after reload when saved from blob URL', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post for blob URL reload test' })
    await waitForItemIdle(item)

    const featureImageProperty = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    const blob = createPngBlob()
    const blobUrl = URL.createObjectURL(blob)
    featureImageProperty.value = blobUrl

    const refResolvedValue = await waitForRefResolvedValue(featureImageProperty)
    expect(refResolvedValue).toBeTruthy()

    const seedLocalId = item.seedLocalId
    URL.revokeObjectURL(blobUrl)
    item.unload()

    const reloadedItem = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloadedItem).toBeTruthy()
    if (!reloadedItem) return
    await waitForItemIdle(reloadedItem)

    const reloadedProp = reloadedItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(reloadedProp).toBeTruthy()
    if (!reloadedProp) return

    await waitForItemPropertyIdle(reloadedProp)

    await expectImageDisplayValue(reloadedProp, refResolvedValue)
  })

  it('data URL still works and persists', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post with data URL' })
    await waitForItemIdle(item)

    const featureImageProperty = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    const dataUrl = `data:image/png;base64,${MINIMAL_PNG_BASE64}`
    featureImageProperty.value = dataUrl

    const refResolvedValue = await waitForRefResolvedValue(featureImageProperty)
    expect(refResolvedValue).toBeTruthy()

    const seedLocalId = item.seedLocalId
    item.unload()

    const reloadedItem = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloadedItem).toBeTruthy()
    if (!reloadedItem) return
    await waitForItemIdle(reloadedItem)

    const reloadedProp = reloadedItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(reloadedProp).toBeTruthy()
    if (!reloadedProp) return

    await waitForItemPropertyIdle(reloadedProp)
    expect(reloadedProp.value).toBeTruthy()
  })

  it('File input still works', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: 5000 })

    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post with File' })
    await waitForItemIdle(item)

    const featureImageProperty = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(featureImageProperty).toBeTruthy()
    if (!featureImageProperty) return

    const file = createPngFile('test-file.png')
    featureImageProperty.value = file

    const refResolvedValue = await waitForRefResolvedValue(featureImageProperty)
    expect(refResolvedValue).toBeTruthy()

    const seedLocalId = item.seedLocalId
    item.unload()

    const reloadedItem = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloadedItem).toBeTruthy()
    if (!reloadedItem) return
    await waitForItemIdle(reloadedItem)

    const reloadedProp = reloadedItem.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any> | undefined
    expect(reloadedProp).toBeTruthy()
    if (!reloadedProp) return

    await waitForItemPropertyIdle(reloadedProp)
    expect(reloadedProp.value).toBeTruthy()
  })
})
