import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { generateId } from '@/helpers/generateId'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { readHtmlBodyForStorageSeedPropertyValue } from '@/helpers/readHtmlBodyForStorageSeed'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedTestAuthor,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const TX_ID = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const BODY = '<p>downloaded body</p>'

// No network: the gateway and Arweave client tiers miss, the download writes the file
vi.mock('@seedprotocol/arweave', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seedprotocol/arweave')>()
  return { ...actual, fetchArweaveRawTextAcrossGateways: vi.fn(async () => undefined) }
})
vi.mock('@/events/files/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/events/files/download')>()
  return {
    ...actual,
    downloadTransactionIdWithDedupe: vi.fn(async (txId: string) => {
      // Downloads are named after the transaction
      await BaseFileManager.saveFile(BaseFileManager.getFilesPath('html', `${txId}.html`), BODY)
      return true
    }),
  }
})

// Node only (__tests__/node): module mocks of @seedprotocol/arweave don't load in browser mode
const testDescribe = describe.sequential || describe

// The Html body lookup for a missing local file (sdk-audit G10-10): the storage seed's transaction id
// comes from its current storageTransactionId row, and the downloaded file is found by the shared
// storage file finder.
testDescribe('Html body from its storage seed', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('reads a downloaded body named after the transaction when the local file is gone', async () => {
    const { BaseArweaveClient } = await import('@seedprotocol/arweave')
    vi.spyOn(BaseArweaveClient, 'getTransactionData').mockRejectedValue(new Error('offline'))

    const author = await createPublishedTestAuthor()
    const item = await Item.create({ modelName: 'Post', title: 'Html body', author: author.seedLocalId } as any)
    await waitForEntityIdle(item, { timeout: WAIT_TIMEOUT_MS })
    await waitForPropertyInstances(item)
    const html = item.allProperties['bodyHtml']!
    html.value = '<p>local body</p>'
    await html.save()
    const ctx = (html.getService().getSnapshot() as any).context
    const htmlSeedLocalId: string = ctx.propertyValue

    await BaseDb.getAppDb()!.insert(metadata).values({
      localId: generateId(),
      seedLocalId: htmlSeedLocalId,
      propertyName: 'storageTransactionId',
      propertyValue: TX_ID,
      modelType: 'html',
      createdAt: Date.now(),
    })
    const fs = await BaseFileManager.getFs()
    await fs.promises.unlink(BaseFileManager.getFilesPath('html', `${htmlSeedLocalId}.html`))

    expect(await readHtmlBodyForStorageSeedPropertyValue(htmlSeedLocalId)).toBe(BODY)
  }, 30000)
})
