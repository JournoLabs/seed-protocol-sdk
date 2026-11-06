import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { generateId } from '@/helpers/generateId'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import { readHtmlBodyForStorageSeedPropertyValue } from '@/helpers/readHtmlBodyForStorageSeed'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedTestAuthor,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/** One transaction id per test, so a file or warning from one test doesn't leak into the next. */
const txId = (last: string) => `JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRp${last}`
const BODY = '<p>published body</p>'

/** Stubs `fetch`: `/raw/` answers come from `raw`; anything else 404s. Returns every requested URL. */
function stubGateways(raw: (url: string) => Response): string[] {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      return url.includes('/raw/') ? raw(url) : new Response('', { status: 404 })
    }),
  )
  return urls
}

const rawBaseUrls = (urls: string[]) => urls.filter((u) => u.includes('/raw/')).map((u) => u.slice(0, u.indexOf('/raw/')))

// Node only (__tests__/node): the browser runs Html body downloads through the OPFS worker.
const testDescribe = describe.sequential || describe

// The Html body lookup for a missing local file (sdk-audit G10-10): the storage seed's transaction id
// comes from its current storageTransactionId row.
testDescribe('Html body from its storage seed', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** An Html storage seed whose local file is gone and whose published transaction is `tx`. */
  async function htmlSeedWithOnlyItsTransaction(tx: string): Promise<string> {
    const author = await createPublishedTestAuthor()
    const item = await Item.create({ modelName: 'Post', title: 'Html body', author: author.seedLocalId } as any)
    await waitForEntityReady(item, { timeout: WAIT_TIMEOUT_MS })
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
      propertyValue: tx,
      modelType: 'html',
      createdAt: Date.now(),
    })
    const fs = await BaseFileManager.getFs()
    await fs.promises.unlink(BaseFileManager.getFilesPath('html', `${htmlSeedLocalId}.html`))
    return htmlSeedLocalId
  }

  it('reads a downloaded body named after the transaction without asking a gateway', async () => {
    const tx = txId('A')
    const htmlSeedLocalId = await htmlSeedWithOnlyItsTransaction(tx)
    await BaseFileManager.saveFile(BaseFileManager.getFilesPath('html', `${tx}.html`), BODY)
    const urls = stubGateways(() => new Response('', { status: 404 }))

    expect(await readHtmlBodyForStorageSeedPropertyValue(htmlSeedLocalId)).toBe(BODY)
    expect(rawBaseUrls(urls)).toEqual([])
  }, 30000)

  it("reads the body from a gateway's /raw", async () => {
    const htmlSeedLocalId = await htmlSeedWithOnlyItsTransaction(txId('B'))
    stubGateways(() => new Response(BODY, { status: 200 }))

    expect(await readHtmlBodyForStorageSeedPropertyValue(htmlSeedLocalId)).toBe(BODY)
  }, 30000)

  it('asks each gateway once and logs one warning naming each when none has the body', async () => {
    const tx = txId('C')
    const htmlSeedLocalId = await htmlSeedWithOnlyItsTransaction(tx)
    const urls = stubGateways(() => new Response('', { status: 404 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await readHtmlBodyForStorageSeedPropertyValue(htmlSeedLocalId)).toBeUndefined()

    const bases = rawBaseUrls(urls)
    expect(bases.length).toBeGreaterThan(0)
    expect(new Set(bases).size).toBe(bases.length)
    // No arweave-js node API reads (`/tx/{id}/offset`, sandbox `/{id}`): they can't serve a data item.
    expect(urls.filter((u) => !u.includes('/raw/') && (u.includes(`/tx/${tx}`) || u.endsWith(`/${tx}`)))).toEqual([])

    const bodyWarnings = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes(tx))
    expect(bodyWarnings).toHaveLength(1)
    for (const base of bases) expect(bodyWarnings[0]).toContain(`${base} 404`)

    // A second read of the same body doesn't repeat the line.
    expect(await readHtmlBodyForStorageSeedPropertyValue(htmlSeedLocalId)).toBeUndefined()
    expect(warn.mock.calls.filter(([line]) => String(line).includes(tx))).toHaveLength(1)
  }, 30000)

  it('does not take an encrypted envelope as the body, or warn about it', async () => {
    const tx = txId('D')
    const htmlSeedLocalId = await htmlSeedWithOnlyItsTransaction(tx)
    stubGateways(() => new Response('seed-private/v1\nbind e30\n-> x-test\nAQ\n--- AAAA\nciphertext', { status: 200 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await readHtmlBodyForStorageSeedPropertyValue(htmlSeedLocalId)).toBeUndefined()
    expect(warn.mock.calls.filter(([line]) => String(line).includes(tx))).toEqual([])
  }, 30000)
})
