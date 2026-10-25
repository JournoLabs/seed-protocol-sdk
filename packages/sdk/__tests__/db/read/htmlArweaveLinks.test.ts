import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { getArweaveReadBaseUrls, getPublicArweaveBaseUrl } from '@seedprotocol/arweave'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { setEntityUnloadGraceMs } from '@/helpers/entity/entityCache'
import { prepareHtmlEmbeddedImagesForPublish } from '@/helpers/htmlEmbeddedDataUriPublish'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { waitForPropertyInstances } from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'

/**
 * ADR 0025: an Html value shows its Arweave links on this reader's gateways, the stored file keeps
 * them as written, and publish uploads them on the public gateway.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema htmlArweaveLinks'
const TX = 'linkTx'.padEnd(43, 'q')

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    LinkPost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        html: { id: generateId(), type: 'Html' },
      },
    },
  },
  enums: {},
  migrations: [],
})

const htmlProperty = (item: Item<any>) => item.properties.find((p) => p.propertyName === 'html')!

const storedHtml = (item: Item<any>) => {
  const context = htmlProperty(item).getService().getSnapshot().context as { refResolvedValue?: string }
  return BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', context.refResolvedValue!))
}

const createPost = async (html: string) => {
  const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'LinkPost', title: 'Links', html } as any)
  await waitForIdle(post, 'Item', 15000)
  await waitForPropertyInstances(post)
  await htmlProperty(post).save()
  return post
}

testDescribe('Arweave links in Html (ADR 0025)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => setEntityUnloadGraceMs(undefined))

  it('shows a loaded Html value with its links on the first read gateway, and keeps the file as written', async () => {
    const written = `<p><img src="https://ar.seedprotocol.io/raw/${TX}"></p>`
    const post = await createPost(written)
    const seedLocalId = post.seedLocalId
    setEntityUnloadGraceMs(0)
    post.unload()

    const loaded = await Item.find({ seedLocalId, hold: true })
    try {
      await waitForPropertyInstances(loaded!)
      const reader = getArweaveReadBaseUrls()[0]
      expect(reader).toBeTruthy()
      await expect.poll(() => htmlProperty(loaded!).value, { timeout: 10000 }).toBe(`<p><img src="${reader}/raw/${TX}"></p>`)
      expect(await storedHtml(loaded!)).toBe(written)
    } finally {
      loaded?.unload()
    }
  })

  it('publish puts links a reader re-hosted onto a local sidecar back on the public gateway', async () => {
    const post = await createPost(`<a href="http://127.0.0.1:1984/raw/${TX}">doc</a>`)
    try {
      await prepareHtmlEmbeddedImagesForPublish(post as any, 'materialize')
      expect(await storedHtml(post)).toBe(`<a href="${getPublicArweaveBaseUrl()}/raw/${TX}">doc</a>`)
    } finally {
      post.unload()
    }
  })
})
