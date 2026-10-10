import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eventEmitter } from '@/eventBus'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@/helpers/constants'
import { resetTabCoordinationForTests, startTabCoordination } from '@/helpers/tabCoordinator'
import {
  FILES_CHANGED_EVENT,
  emitAcrossTabs,
  listenForOtherTabsEvents,
  notifyFileSaved,
} from '@/helpers/tabEvents'
import { Item } from '@/Item/Item'
import { otherTab, type OtherTab } from '../../test-utils/otherTab'

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
      })
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
    await tab.send({ type: 'listen', channel }, 'listening')
    const fileSaved = vi.fn()
    eventEmitter.on('file-saved', fileSaved)

    try {
      emitAcrossTabs(EAS_SEED_DATA_SYNCED_TO_DB_EVENT)
      notifyFileSaved(`${filesDir}/files/html/x.html`)

      // Local listeners still hear file-saved; the other tab gets a cache refresh instead.
      expect(fileSaved).toHaveBeenCalledWith(`${filesDir}/files/html/x.html`)
      await vi.waitFor(() =>
        expect(tab!.heard).toEqual([
          { type: 'event', name: EAS_SEED_DATA_SYNCED_TO_DB_EVENT, payload: undefined },
          { type: 'files-changed', paths: [`${filesDir}/files/html/x.html`] },
        ]),
      )
    } finally {
      eventEmitter.off('file-saved', fileSaved)
    }
  })
})
