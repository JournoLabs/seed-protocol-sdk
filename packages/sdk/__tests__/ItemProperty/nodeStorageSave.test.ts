import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { validateItemForPublish } from '@/db/read/getPublishPayload'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedTestAuthor,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { createMetadata } from '@/db/write/createMetadata'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties } from '@/seedSchema/ModelSchema'
import { metadata } from '@/seedSchema/MetadataSchema'
import { and, eq } from 'drizzle-orm'

// Html saves in Node: saveHtml used to throw from NodeFileManager.getContentUrlFromPath, and
// ItemProperty.save() resolved anyway, so raw HTML reached publish encoding.
const testDescribe =
  typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('Html property saves in Node', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: 90000 })
    await createGetPublishPayloadTestSchema()
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createPost = async () => {
    const item = await Item.create({ modelName: 'Post', title: 'Node html post' })
    await waitForEntityIdle(item, { timeout: 10_000 })
    await waitForPropertyInstances(item)
    const html = item.allProperties['bodyHtml']
    expect(html).toBeDefined()
    return { item, html: html! }
  }

  // permapress #11: createMetadata used Number(propertyRecordSchema.id) on the schemaFileId string
  // -> NaN property_id -> better-sqlite3 RangeError, surfaced only as "Failed query: insert into metadata".
  it('stores html as a storage seed and save() resolves', async () => {
    const { html } = await createPost()
    html.value = '<p>Hello from Node</p>'
    await html.save()

    const ctx = (html.getService().getSnapshot() as any).context
    expect(ctx._saveError).toBeFalsy()
    expect(ctx.refSeedType).toBe('html')
    expect(ctx.refResolvedDisplayValue).toMatch(/^file:\/\//)
    expect(typeof ctx.propertyValue).toBe('string')
    expect(ctx.propertyValue).not.toContain('<p>')

    const filePath = BaseFileManager.getFilesPath('html', ctx.refResolvedValue)
    expect(await BaseFileManager.readFileAsString(filePath)).toBe('<p>Hello from Node</p>')
  }, 30000)

  it('save() rejects when the html save pipeline fails', async () => {
    const { html } = await createPost()
    vi.spyOn(BaseFileManager, 'getContentUrlFromPath').mockRejectedValueOnce(
      new Error('Not implemented'),
    )
    html.value = '<p>Will fail</p>'
    await expect(html.save()).rejects.toThrow(/Failed to save property bodyHtml: Not implemented/)
  }, 30000)

  it('Item.create runs raw html through the save pipeline', async () => {
    const author = await createPublishedTestAuthor()
    const item = await Item.create({
      modelName: 'Post',
      title: 'Created with html',
      author: author.seedLocalId,
      bodyHtml: '<p>raw</p>',
    } as any)
    const ctx = (item.allProperties['bodyHtml']!.getService().getSnapshot() as any).context
    expect(ctx.refSeedType).toBe('html')
    expect(ctx.propertyValue).not.toContain('<p>')
    const filePath = BaseFileManager.getFilesPath('html', ctx.refResolvedValue)
    expect(await BaseFileManager.readFileAsString(filePath)).toBe('<p>raw</p>')

    const result = await validateItemForPublish(item)
    expect(result.errors.filter((e) => e.code === 'publish_storage_value_not_saved')).toEqual([])
  }, 30000)

  it('Item.create stores an array List value as a JSON id list that publishes', async () => {
    const author = await createPublishedTestAuthor()
    const tags = []
    for (const label of ['one', 'two']) {
      const tag = await Item.create({ modelName: 'Tag', label } as any)
      tags.push(tag)
    }
    const item = await Item.create({
      modelName: 'Post',
      title: 'Array list',
      author: author.seedLocalId,
      tagIds: tags.map((t) => t.seedLocalId),
    } as any)
    const rows = await BaseDb.getAppDb()!
      .select({ propertyValue: metadata.propertyValue })
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, item.seedLocalId!), eq(metadata.propertyName, 'tagIds')))
    expect(rows.map((r: { propertyValue: string | null }) => r.propertyValue)).toContain(JSON.stringify(tags.map((t) => t.seedLocalId)))

    const result = await validateItemForPublish(item)
    expect(result.errors).toEqual([])
  }, 30000)

  it('Item.create runs a raw image value through the save pipeline', async () => {
    const author = await createPublishedTestAuthor()
    // 1x1 transparent PNG
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const item = await Item.create({
      modelName: 'Post',
      title: 'With image',
      author: author.seedLocalId,
      coverImage: png,
    } as any)
    const ctx = (item.allProperties['coverImage']!.getService().getSnapshot() as any).context
    expect(ctx.propertyValue).not.toContain('data:')
    const result = await validateItemForPublish(item)
    expect(result.errors.filter((e) => e.code === 'publish_storage_value_not_saved')).toEqual([])
  }, 30000)

  it('Item.create rejects when an html value fails to save', async () => {
    vi.spyOn(BaseFileManager, 'getContentUrlFromPath').mockRejectedValueOnce(new Error('disk gone'))
    await expect(
      Item.create({ modelName: 'Post', title: 'Will fail', bodyHtml: '<p>x</p>' } as any),
    ).rejects.toThrow(/Item\.create: failed to save Post\.bodyHtml .*disk gone/)
  }, 30000)

  it('assigning item.<html property> saves through the pipeline', async () => {
    const { item, html } = await createPost()
    ;(item as any).bodyHtml = '<p>assigned</p>'
    await html.save()
    const ctx = (html.getService().getSnapshot() as any).context
    expect(ctx.refSeedType).toBe('html')
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', ctx.refResolvedValue))).toBe(
      '<p>assigned</p>',
    )
  }, 30000)

  it('save() waits for the schema to resolve when the property has none yet', async () => {
    const { html } = await createPost()
    // Simulate a property instance created before its schema loaded.
    html.getService().send({ type: 'updateContext', propertyRecordSchema: undefined })
    html.value = '<p>late schema</p>'
    await html.save()
    const ctx = (html.getService().getSnapshot() as any).context
    expect(ctx.refSeedType).toBe('html')
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', ctx.refResolvedValue))).toBe(
      '<p>late schema</p>',
    )
  }, 30000)

  it('publish validation rejects raw html written without the save pipeline', async () => {
    // createNewItem is the low-level writer: it stores initial values verbatim.
    const author = await createPublishedTestAuthor()
    const { seedLocalId } = await createNewItem({
      modelName: 'Post',
      title: 'Raw html post',
      author: author.seedLocalId,
      bodyHtml: '<p>raw</p>',
    })
    const item = (await Item.find({ modelName: 'Post', seedLocalId })) as Item<any>
    await waitForEntityIdle(item, { timeout: 10_000 })
    await waitForPropertyInstances(item)

    const result = await validateItemForPublish(item)
    expect(result.isValid).toBe(false)
    expect(result.errors.filter((e) => e.code === 'publish_storage_value_not_saved')).toEqual([
      expect.objectContaining({ field: 'bodyHtml' }),
    ])
  }, 30000)

  describe('createMetadata property_id resolution', () => {
    const getBodyHtmlRow = async () => {
      const rows = await BaseDb.getAppDb()!
        .select({ id: properties.id, schemaFileId: properties.schemaFileId })
        .from(properties)
        .innerJoin(modelsTable, eq(properties.modelId, modelsTable.id))
        .where(and(eq(modelsTable.name, 'Post'), eq(properties.name, 'bodyHtml')))
        .limit(1)
      expect(rows[0]).toBeDefined()
      return rows[0]!
    }
    const insert = (propertyRecordSchema: any) =>
      createMetadata(
        { propertyName: 'bodyHtmlId', propertyValue: 'abcdefghij', seedLocalId: 'zyxwvutsrq', modelName: 'Post' },
        propertyRecordSchema,
        { skipValidation: true },
      )

    it('resolves a schemaFileId string to properties.id', async () => {
      const row = await getBodyHtmlRow()
      expect(row.schemaFileId).toBeTruthy()
      const inserted = await insert({ id: row.schemaFileId, dataType: 'Html' })
      expect(inserted.propertyId).toBe(row.id)
    })

    it('uses an integer id as properties.id', async () => {
      const row = await getBodyHtmlRow()
      const inserted = await insert({ id: row.id, dataType: 'Html' })
      expect(inserted.propertyId).toBe(row.id)
    })

    it('falls back to model + property name for an unknown schemaFileId', async () => {
      const row = await getBodyHtmlRow()
      const inserted = await insert({ id: 'notARealId', dataType: 'Html' })
      expect(inserted.propertyId).toBe(row.id)
    })
  })
})
