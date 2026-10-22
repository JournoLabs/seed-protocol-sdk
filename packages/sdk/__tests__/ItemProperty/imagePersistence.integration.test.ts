/**
 * Integration tests for Image property persistence.
 * Verifies that Blob and blob URL inputs are saved to files and survive reload.
 */
import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest'
import { waitFor } from 'xstate'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ClearNotSupportedError, ItemProperty } from '@/ItemProperty/ItemProperty'
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
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

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
 * The value of an Image property loaded from the DB after its item was unloaded. Browser: a blob:
 * URL. Node: loading reads the saved file into a blob: URL too (loadOrCreateProperty), although a
 * save in Node leaves the saved filename (NodeFileManager.getContentUrlFromPath returns file://,
 * d0159c8); the saved file must exist.
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
  expect([savedFileName, 'blob:']).toContain(
    typeof renderValue === 'string' && renderValue.startsWith('blob:') ? 'blob:' : renderValue,
  )
  expect(await BaseFileManager.pathExists(BaseFileManager.getFilesPath('images', savedFileName!))).toBe(true)
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
          attachment: {
            id: generateId(),
            type: 'File',
          },
          featured: {
            id: generateId(),
            type: 'Boolean',
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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

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
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

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

  it('keeps two uploads with the same file name apart', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })

    const upload = async (title: string, bytes: number[]) => {
      const item = await Item.create({ modelName: 'Post', schemaName, title })
      await waitForItemIdle(item)
      const property = item.properties.find(
        (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
      ) as ItemProperty<any>
      property.value = new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' })
      return waitForRefResolvedValue(property)
    }

    const first = await upload('First post', [1, 2, 3])
    const second = await upload('Second post', [4, 5, 6, 7])

    expect(first).not.toBe(second)
    expect(first?.endsWith('photo.png')).toBe(true)
    expect(second?.endsWith('photo.png')).toBe(true)
    const read = async (name: string | undefined) =>
      new Uint8Array(
        await (await BaseFileManager.readFile(BaseFileManager.getFilesPath('images', name!))).arrayBuffer()
      )
    expect([...(await read(first))]).toEqual([1, 2, 3])
    expect([...(await read(second))]).toEqual([4, 5, 6, 7])
  })

  /** Wait for a save to settle: not saving, and the error or validation errors it ended with. */
  async function waitForSaveSettled(property: ItemProperty<any>) {
    const snapshot = await waitFor(
      property.getService(),
      (s) => {
        const ctx = s.context as Record<string, any>
        return !ctx.isSaving && (!!ctx._saveError || !!ctx._saveValidationErrors?.length)
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    return snapshot.context as Record<string, any>
  }

  async function itemWithSavedImage(title: string) {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })
    const item = await Item.create({ modelName: 'Post', schemaName, title })
    await waitForItemIdle(item)
    const property = item.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any>
    property.value = createPngFile('cover.png')
    await waitForRefResolvedValue(property)
    const saved = property.getService().getSnapshot().context as Record<string, any>
    return { item, property, saved }
  }

  const imageSeedCount = async () =>
    (await BaseDb.getAppDb()!.select({ localId: seeds.localId }).from(seeds).where(eq(seeds.type, 'image'))).length

  const latestRow = async (seedLocalId: string, propertyName: string) =>
    (
      await BaseDb.getAppDb()!
        .select()
        .from(metadata)
        .where(eq(metadata.seedLocalId, seedLocalId))
    )
      .filter((r) => r.propertyName === propertyName || r.propertyName === `${propertyName}Id`)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]

  for (const [label, clearIt] of [
    ["''", (p: ItemProperty<any>) => { p.value = ''; return p.save() }],
    ['null', (p: ItemProperty<any>) => { p.value = null; return p.save() }],
    ['clear()', (p: ItemProperty<any>) => p.clear()],
  ] as const) {
    it(`clears an Image with ${label} and keeps the old image seed and file`, async () => {
      const { item, property, saved } = await itemWithSavedImage(`Post cleared with ${label}`)
      const seedsBefore = await imageSeedCount()

      await clearIt(property)

      const ctx = property.getService().getSnapshot().context as Record<string, any>
      expect(ctx._saveValidationErrors ?? []).toEqual([])
      expect(ctx._saveError ?? null).toBeNull()
      expect(ctx.propertyValue ?? null).toBeNull()
      expect(property.value ?? null).toBeNull()
      const row = await latestRow(item.seedLocalId!, 'featureImage')
      expect(row.propertyValue).toBeNull()
      expect(row.refResolvedValue).toBeNull()
      expect(row.retract ?? null).toBeNull()
      // Nothing new is stored, and the old image stays, as when an image is replaced
      expect(await imageSeedCount()).toBe(seedsBefore)
      expect(await BaseFileManager.pathExists(BaseFileManager.getFilesPath('images', saved.refResolvedValue))).toBe(true)
    })
  }

  it('reads a cleared Image as empty after reload', async () => {
    const { item, property } = await itemWithSavedImage('Post cleared before reload')
    await property.clear()

    const seedLocalId = item.seedLocalId
    item.unload()
    const reloaded = await Item.find({ modelName: 'Post', seedLocalId })
    expect(reloaded).toBeTruthy()
    await waitForItemIdle(reloaded!)
    const reloadedProp = reloaded!.properties.find(
      (p) => p.propertyName === 'featureImage' || p.propertyName === 'featureImageId'
    ) as ItemProperty<any>
    await waitForItemPropertyIdle(reloadedProp)

    expect(reloadedProp.value ?? null).toBeNull()
    expect(reloadedProp.refResolvedValue ?? null).toBeNull()
  })

  it('marks a retracted clear on its row, and a later value unmarks it', async () => {
    const { item, property } = await itemWithSavedImage('Post retracted')

    await property.clear({ retract: true })
    expect((await latestRow(item.seedLocalId!, 'featureImage')).retract).toBe(true)

    property.value = createPngFile('again.png')
    await waitForRefResolvedValue(property)
    const row = await latestRow(item.seedLocalId!, 'featureImage')
    expect(row.retract ?? null).toBeNull()
    expect(row.refResolvedValue).toBeTruthy()
  })

  it("clears a File with ''", async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })
    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Post with empty attachment' })
    await waitForItemIdle(item)
    const property = item.properties.find((p) => p.propertyName === 'attachment') as ItemProperty<any>
    expect(property).toBeTruthy()

    property.value = ''
    await property.save()

    const fileSeeds = await BaseDb.getAppDb()!.select({ localId: seeds.localId }).from(seeds).where(eq(seeds.type, 'file'))
    expect(fileSeeds).toEqual([])
    expect(property.value ?? null).toBeNull()
  })

  it('refuses to clear a Boolean without retract, and leaves its value', async () => {
    const model = Model.create('Post', schemaName, { waitForReady: false })
    await waitFor(model.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })
    const item = await Item.create({ modelName: 'Post', schemaName, title: 'Featured post', featured: true })
    await waitForItemIdle(item)
    const property = item.properties.find((p) => p.propertyName === 'featured') as ItemProperty<any>

    await expect(property.clear()).rejects.toBeInstanceOf(ClearNotSupportedError)
    expect(property.value).toBeTruthy()

    await property.clear({ retract: true })
    expect((await latestRow(item.seedLocalId!, 'featured')).retract).toBe(true)
  })

  it('shows the saved image again when saving a new one fails (decision D2)', async () => {
    const { property, saved } = await itemWithSavedImage('Post with a failed image save')

    // Not a file name, data URL or URL: preparing the op finds no file data and fails it, and the
    // property shows the overlay's next value, the stored row
    property.value = 'not an image!'
    const ctx = await waitForSaveSettled(property)

    expect(ctx._saveError?.message).toBe('No file data found')
    expect(ctx.propertyValue).toBe(saved.propertyValue)
    expect(ctx.refResolvedValue).toBe(saved.refResolvedValue)
    await expect(property.save()).rejects.toThrow('No file data found')
  })
})
