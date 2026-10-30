import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { client } from '@/client'
import { BaseDb } from '@/db/Db/BaseDb'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { seeds } from '@/seedSchema'
import { createTestConfig } from '../test-utils/client-init'
import { otherTab, type OtherTab } from '../test-utils/otherTab'

/**
 * client.resetLocalData() in one page. Its own filesDir: browser test files share OPFS, and a reset
 * of the shared one would delete other files' data. Other tabs stopping on `close-db` is covered
 * with real tabs in multiTab.e2e.test.ts.
 */
describe('client.resetLocalData()', () => {
  const filesDir = `/reset-${Math.random().toString(36).slice(2, 8)}`
  const options = createTestConfig({ config: { models: {}, filesDir } })
  let tab: OtherTab | undefined

  const opfsDir = async () => {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(filesDir.slice(1)).catch(() => undefined)
  }

  /** Init, a seed row and a file saved through the file system. */
  const initWithData = async () => {
    await client.init(options)
    await BaseDb.getAppDb()!.insert(seeds).values({ localId: 'reset-seed', type: 'note', createdAt: Date.now() })
    const notePath = `${filesDir}/files/note.txt`
    await BaseFileManager.createDirIfNotExists(`${filesDir}/files`)
    await BaseFileManager.saveFile(notePath, 'kept until the reset')
    return notePath
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    tab?.worker.terminate()
    tab = undefined
  })

  afterAll(async () => {
    if (client.isInitialized()) await client.stop()
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(filesDir.slice(1), { recursive: true }).catch(() => {})
  })

  it('deletes the database and files, and the next init starts empty', async () => {
    const notePath = await initWithData()

    const result = await client.resetLocalData()

    expect(result.failed).toEqual([])
    expect(result.deleted).toEqual(expect.arrayContaining([`${filesDir}/db/seed.db`, notePath, filesDir]))
    expect(result.deleted.at(-1)).toBe(filesDir)
    expect(await opfsDir()).toBeUndefined()
    const snapshot = client.getService().getSnapshot()
    expect(snapshot.status).toBe('stopped')
    expect(snapshot.context.stopReason).toBe('reset')

    await client.init(options)
    expect(await BaseDb.getAppDb()!.select().from(seeds)).toEqual([])
    expect(await BaseFileManager.pathExists(notePath)).toBe(false)
    expect(client.getService().getSnapshot().context.stopReason).toBeUndefined()
  }, 60_000)

  it('works after an init that failed with the database open', async () => {
    await initWithData()
    await client.stop()
    const prepareDb = BaseDb.prepareDb.bind(BaseDb)
    vi.spyOn(BaseDb, 'prepareDb').mockImplementationOnce(async (...args) => {
      await prepareDb(...args)
      throw new Error('init step failed (test)')
    })
    await expect(client.init(options)).rejects.toThrow('init step failed (test)')

    const result = await client.resetLocalData()

    expect(result.failed).toEqual([])
    expect(await opfsDir()).toBeUndefined()
    await client.init(options)
    expect(await BaseDb.getAppDb()!.select().from(seeds)).toEqual([])
  }, 60_000)

  it("reports a file a tab that doesn't close keeps open, and deletes the rest", async () => {
    const notePath = await initWithData()
    await client.stop()
    // A tab that holds the database open and ignores close-db.
    tab = otherTab()
    await tab.send({ type: 'hold-shared', name: `seed:open:${filesDir}/db/seed.db` }, 'holding-shared')
    await tab.send({ type: 'hold-file', path: `${filesDir}/db/seed.db` }, 'holding-file')

    const started = Date.now()
    const result = await client.resetLocalData({ otherTabsTimeoutMs: 300 })

    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    expect(result.failed.map((failure) => failure.path)).toEqual([`${filesDir}/db/seed.db`])
    expect(result.failed[0].error).toMatch(/^NoModificationAllowedError|^InvalidModificationError/)
    expect(result.deleted).toContain(notePath)
    expect(result.deleted).not.toContain(filesDir)

    // Once the tab lets go, a second reset removes what was left.
    await tab.send({ type: 'release-file' }, 'released-file')
    const second = await client.resetLocalData()
    expect(second.failed).toEqual([])
    expect(second.deleted).toEqual(expect.arrayContaining([`${filesDir}/db/seed.db`, filesDir]))
    expect(await opfsDir()).toBeUndefined()
  }, 60_000)

  it('waits for a reset in progress before init opens the database', async () => {
    await initWithData()
    const reset = client.resetLocalData()
    const init = client.init(options)
    const result = await reset
    await init
    expect(result.failed).toEqual([])
    expect(await BaseDb.getAppDb()!.select().from(seeds)).toEqual([])
  }, 60_000)
})
