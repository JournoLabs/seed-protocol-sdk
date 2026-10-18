import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eventEmitter } from '@/eventBus'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@/helpers/constants'
import { resetTabCoordinationForTests, startTabCoordination, TAB_ID } from '@/helpers/tabCoordinator'
import {
  FILES_CHANGED_EVENT,
  FILES_CHANGED_FLUSH_MS,
  FILES_CHANGED_MAX_PATHS,
  emitAcrossTabs,
  flushFilesChangedNotices,
  listenForOtherTabsEvents,
  notifyFileSaved,
  queueFilesChangedNotice,
} from '@/helpers/tabEvents'
import { Item } from '@/Item/Item'
import { otherTab, type OtherTab } from '../../test-utils/otherTab'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

describe('events across tabs', () => {
  const testDir = `tab-events-${Math.random().toString(36).slice(2, 8)}`
  const filesDir = `/${testDir}`
  const channel = `seed:tabs:${filesDir}/db/seed.db`
  let tab: OtherTab | undefined

  beforeAll(async () => {
    const { configurePlatform } = await import('@/platform/configurePlatform')
    const { createPlatformServices } = await import('@/platform/index.browser')
    configurePlatform(createPlatformServices())
    await BaseFileManager.initializeFileSystem()
    listenForOtherTabsEvents()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    flushFilesChangedNotices() // Nothing queued here may land in the next test's channel.
    resetTabCoordinationForTests()
    tab?.worker.terminate()
    tab = undefined
  })

  afterAll(async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(testDir, { recursive: true }).catch(() => {})
  })

  it('reads a file another tab rewrote once its cache is refreshed', async () => {
    const filePath = `${filesDir}/files/note.txt`
    await BaseFileManager.createDirIfNotExists(`${filesDir}/files`)
    await BaseFileManager.saveFile(filePath, 'v1')
    expect(await BaseFileManager.readFileAsString(filePath)).toBe('v1')

    // Another tab (or a download worker) rewrites it straight to OPFS.
    const root = await navigator.storage.getDirectory()
    const dir = await (await root.getDirectoryHandle(testDir)).getDirectoryHandle('files')
    const writable = await (await dir.getFileHandle('note.txt')).createWritable()
    await writable.write('version two')
    await writable.close()

    await BaseFileManager.invalidateCachedPaths([filePath])
    expect(await BaseFileManager.readFileAsString(filePath)).toBe('version two')
  })

  it("applies another tab's file changes and EAS sync here", async () => {
    startTabCoordination({ filesDir })
    const invalidated = vi.spyOn(BaseFileManager, 'invalidateCachedPaths')
    const rehydrated = vi.spyOn(Item, 'rehydrateCachedItemsFromDbAfterEasSync').mockResolvedValue(undefined as never)
    const filesChanged = vi.fn()
    const synced = vi.fn()
    eventEmitter.on(FILES_CHANGED_EVENT, filesChanged)
    eventEmitter.on(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, synced)

    try {
      tab = otherTab()
      const paths = [`${filesDir}/files/images/abc`]
      await tab.send({ type: 'post', channel, message: { type: 'files-changed', paths } }, 'posted')
      await tab.send({ type: 'post', channel, message: { type: 'event', name: EAS_SEED_DATA_SYNCED_TO_DB_EVENT } }, 'posted')

      await vi.waitFor(() => {
        expect(filesChanged).toHaveBeenCalledWith(paths)
        expect(synced).toHaveBeenCalled()
      }, { timeout: WAIT_TIMEOUT_MS })
      expect(invalidated).toHaveBeenCalledWith(paths)
      // Cached Items reload before listeners hear the sync finished.
      expect(rehydrated.mock.invocationCallOrder[0]).toBeLessThan(synced.mock.invocationCallOrder[0])
    } finally {
      eventEmitter.off(FILES_CHANGED_EVENT, filesChanged)
      eventEmitter.off(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, synced)
    }
  })

  it('tells other tabs about events and saves from this tab', async () => {
    startTabCoordination({ filesDir })
    tab = otherTab()
    await tab.listen(channel)
    const fileSaved = vi.fn()
    eventEmitter.on('file-saved', fileSaved)
    const htmlPath = `${filesDir}/files/html/x.html`

    try {
      emitAcrossTabs(EAS_SEED_DATA_SYNCED_TO_DB_EVENT)
      await BaseFileManager.createDirIfNotExists(`${filesDir}/files/html`)
      await BaseFileManager.saveFile(htmlPath, '<p>x</p>')
      notifyFileSaved(htmlPath)

      // Local listeners still hear file-saved; the other tab gets a cache refresh, sent by the
      // file system once the write reached OPFS (notifyFileSaved adds no second message).
      expect(fileSaved).toHaveBeenCalledWith(htmlPath)
      // vi.waitFor's 1s default isn't enough for a round trip through another thread on a loaded runner
      await vi.waitFor(
        () =>
          expect(tab!.heard).toEqual([
            { type: 'event', name: EAS_SEED_DATA_SYNCED_TO_DB_EVENT, payload: undefined, from: TAB_ID },
            { type: 'files-changed', paths: [htmlPath], from: TAB_ID },
          ]),
        { timeout: WAIT_TIMEOUT_MS },
      )
      await new Promise((resolve) => setTimeout(resolve, FILES_CHANGED_FLUSH_MS * 4))
      expect(tab.heard).toHaveLength(2)
    } finally {
      eventEmitter.off('file-saved', fileSaved)
    }
  })

  it('announces sync-API writes, renames and removals once they reach OPFS', async () => {
    startTabCoordination({ filesDir })
    tab = otherTab()
    await tab.listen(channel)
    const dir = `${filesDir}/files/sync`
    await BaseFileManager.createDirIfNotExists(dir)
    const fs = await BaseFileManager.getFs()
    const heardPaths = () =>
      new Set((tab!.heard as Array<{ type: string; paths: string[] }>).flatMap((message) => message.paths))

    BaseFileManager.saveFileSync(`${dir}/a.txt`, 'a')
    await vi.waitFor(() => expect(heardPaths()).toContain(`${dir}/a.txt`), { timeout: WAIT_TIMEOUT_MS })
    // By the time it's announced, OPFS has it.
    const handle = await (await navigator.storage.getDirectory())
      .getDirectoryHandle(testDir)
      .then((d) => d.getDirectoryHandle('files'))
      .then((d) => d.getDirectoryHandle('sync'))
      .then((d) => d.getFileHandle('a.txt'))
    expect(await (await handle.getFile()).text()).toBe('a')

    await fs.promises.rename(`${dir}/a.txt`, `${dir}/b.txt`)
    await fs.promises.unlink(`${dir}/b.txt`)
    await vi.waitFor(() => expect(heardPaths()).toContain(`${dir}/b.txt`), { timeout: WAIT_TIMEOUT_MS })
  })

  it('coalesces bulk saves into a few messages', async () => {
    startTabCoordination({ filesDir })
    tab = otherTab()
    await tab.listen(channel)
    const dir = `${filesDir}/files/bulk`
    await BaseFileManager.createDirIfNotExists(dir)
    const paths = Array.from({ length: 30 }, (_, i) => `${dir}/f${i}.json`)

    await Promise.all(paths.map((path) => BaseFileManager.saveFile(path, '{}')))
    await vi.waitFor(
      () => {
        const heard = tab!.heard as Array<{ paths: string[] }>
        expect(new Set(heard.flatMap((message) => message.paths))).toEqual(new Set(paths))
      },
      { timeout: WAIT_TIMEOUT_MS },
    )
    const heard = tab.heard as Array<{ paths: string[] }>
    expect(heard.length).toBeLessThan(paths.length / 3)
    // Each path once per message, however many ZenFS calls (truncate, write, sync) the save made.
    for (const message of heard) expect(new Set(message.paths).size).toBe(message.paths.length)
  })

  it('splits a huge batch and sends nothing when not coordinating', async () => {
    const paths = Array.from({ length: FILES_CHANGED_MAX_PATHS * 2 + 3 }, (_, i) => `${filesDir}/p${i}`)
    queueFilesChangedNotice(paths) // Not coordinating yet: dropped.

    startTabCoordination({ filesDir })
    tab = otherTab()
    await tab.listen(channel)
    flushFilesChangedNotices()
    queueFilesChangedNotice(paths)
    flushFilesChangedNotices()
    await vi.waitFor(() => expect(tab!.heard).toHaveLength(3), { timeout: WAIT_TIMEOUT_MS })
    expect((tab.heard as Array<{ paths: string[] }>).map((message) => message.paths.length)).toEqual([
      FILES_CHANGED_MAX_PATHS,
      FILES_CHANGED_MAX_PATHS,
      3,
    ])
  })

  it("refreshes this tab's caches on another tab's notice without writing or answering", async () => {
    const filePath = `${filesDir}/files/echo.txt`
    await BaseFileManager.createDirIfNotExists(`${filesDir}/files`)
    await BaseFileManager.saveFile(filePath, 'v1')
    startTabCoordination({ filesDir })
    tab = otherTab()
    await tab.listen(channel)

    // Another tab rewrites it in OPFS and says so.
    const root = await navigator.storage.getDirectory()
    const dir = await (await root.getDirectoryHandle(testDir)).getDirectoryHandle('files')
    const writable = await (await dir.getFileHandle('echo.txt')).createWritable()
    await writable.write('from the other tab')
    await writable.close()
    const filesChanged = vi.fn()
    eventEmitter.on(FILES_CHANGED_EVENT, filesChanged)
    try {
      const notice = { type: 'files-changed', paths: [filePath, `${filesDir}/files/never-seen.txt`], from: 'b' }
      await tab.send({ type: 'post', channel, message: notice }, 'posted')
      await vi.waitFor(() => expect(filesChanged).toHaveBeenCalled(), { timeout: WAIT_TIMEOUT_MS })

      // The sync API's copy is fresh, with no stat() here.
      expect(await BaseFileManager.readFileSync(filePath).text()).toBe('from the other tab')
      expect(() => BaseFileManager.readFileSync(`${filesDir}/files/never-seen.txt`)).toThrow()
      await new Promise((resolve) => setTimeout(resolve, FILES_CHANGED_FLUSH_MS * 4))
      // The other tab heard only its own post: nothing came back from this tab.
      expect(tab.heard).toEqual([notice])
    } finally {
      eventEmitter.off(FILES_CHANGED_EVENT, filesChanged)
    }
  })
})
