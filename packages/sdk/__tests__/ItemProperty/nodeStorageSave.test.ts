import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { validateItemForPublish } from '@/db/read/getPublishPayload'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'

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

  // Repro for permapress #11: createMetadata coerces the schemaFileId string in
  // propertyRecordSchema.id with Number() -> NaN -> better-sqlite3 RangeError on property_id.
  // Flip to it() once createMetadata resolves property_id by model + name.
  it.fails('stores html as a storage seed and save() resolves', async () => {
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

  it('publish validation rejects raw html that never went through the save pipeline', async () => {
    // Item.create writes initial values straight to metadata (createNewItem), skipping saveHtml.
    const author = await Item.create({ modelName: 'Author', name: 'Raw Html Author' })
    await waitForEntityIdle(author, { timeout: 10_000 })
    const item = await Item.create({
      modelName: 'Post',
      title: 'Raw html post',
      author: author.seedLocalId,
      bodyHtml: '<p>raw</p>',
    })
    await waitForEntityIdle(item, { timeout: 10_000 })
    await waitForPropertyInstances(item)

    const result = await validateItemForPublish(item)
    expect(result.isValid).toBe(false)
    expect(result.errors.filter((e) => e.code === 'publish_storage_value_not_saved')).toEqual([
      expect.objectContaining({ field: 'bodyHtml' }),
    ])
  }, 30000)
})
