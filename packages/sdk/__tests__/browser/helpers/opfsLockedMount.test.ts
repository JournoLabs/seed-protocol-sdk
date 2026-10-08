import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserFileManager } from '@/browser/helpers/FileManager'
import { FileSystemLockedError } from '@/helpers/FileManager/errors'

/**
 * SQLocal holds sync access handles on `${filesDir}/db/seed.db` (and its journal) while a tab
 * uses the database. ZenFS's WebAccess mount walks all of OPFS and calls getFile() on every
 * file, so another tab or a not-yet-terminated worker using the DB must not fail init.
 *
 * In headless Chromium 153, getFile() on a locked file succeeds; what fails the stock walk is a
 * journal removed between listing and getFile() (NotFoundError). Older Chromium builds have been
 * reported to throw InvalidStateError for locked files; tolerantWebAccess.test.ts covers that.
 */

const LOCK_WORKER_SOURCE = `
let handle
let churning = false
self.onmessage = async (event) => {
  const { type, path } = event.data
  if (type === 'churn') {
    // Like SQLite's rollback journal: created and removed on every transaction.
    churning = true
    const segments = path.split('/').filter(Boolean)
    const fileName = segments.pop()
    let dir = await navigator.storage.getDirectory()
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create: true })
    }
    self.postMessage({ type: 'locked' })
    while (churning) {
      const journal = await (await dir.getFileHandle(fileName, { create: true })).createSyncAccessHandle()
      journal.write(new Uint8Array(512))
      journal.flush()
      journal.close()
      await dir.removeEntry(fileName)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  if (type === 'lock') {
    try {
      const segments = path.split('/').filter(Boolean)
      const fileName = segments.pop()
      let dir = await navigator.storage.getDirectory()
      for (const segment of segments) {
        dir = await dir.getDirectoryHandle(segment, { create: true })
      }
      const fileHandle = await dir.getFileHandle(fileName, { create: true })
      handle = await fileHandle.createSyncAccessHandle()
      handle.write(new TextEncoder().encode('locked sqlite bytes'))
      handle.flush()
      self.postMessage({ type: 'locked' })
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error) })
    }
  }
  if (type === 'release') {
    churning = false
    handle?.close()
    handle = undefined
    self.postMessage({ type: 'released' })
  }
}
`

function startLockWorker(path: string, type: 'lock' | 'churn' = 'lock'): Promise<Worker> {
  const url = URL.createObjectURL(new Blob([LOCK_WORKER_SOURCE], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      if (event.data.type === 'locked') resolve(worker)
      if (event.data.type === 'error') reject(new Error(event.data.message))
    }
    worker.postMessage({ type, path })
  })
}

function releaseLockWorker(worker: Worker): Promise<void> {
  return new Promise((resolve) => {
    worker.onmessage = (event) => {
      if (event.data.type === 'released') resolve()
    }
    worker.postMessage({ type: 'release' })
  })
}

describe('BrowserFileManager.initializeFileSystem with a locked OPFS file', () => {
  const testDir = `opfs-locked-mount-${Math.random().toString(36).slice(2, 10)}`
  let worker: Worker | undefined

  afterEach(async () => {
    if (worker) {
      await releaseLockWorker(worker)
      worker.terminate()
      worker = undefined
    }
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(testDir, { recursive: true }).catch(() => {})
  })

  it('mounts while another context holds a sync access handle on seed.db', async () => {
    const dbPath = `/${testDir}/db/seed.db`
    const readablePath = `/${testDir}/files/readable.txt`

    const root = await navigator.storage.getDirectory()
    const filesDir = await (await root.getDirectoryHandle(testDir, { create: true }))
      .getDirectoryHandle('files', { create: true })
    const writable = await (await filesDir.getFileHandle('readable.txt', { create: true })).createWritable()
    await writable.write('hello')
    await writable.close()

    worker = await startLockWorker(dbPath)

    const fileManager = new BrowserFileManager()
    await fileManager.initializeFileSystem()

    const fs = await fileManager.getFs()
    // Unlocked files are indexed as usual.
    expect(await fs.promises.readFile(readablePath, 'utf8')).toBe('hello')
    // The locked file is still listed, so ZenFS knows the directory's contents.
    expect(await fs.promises.readdir(`/${testDir}/db`)).toContain('seed.db')

    // Once the lock is released, the skipped file resolves lazily through stat().
    await releaseLockWorker(worker)
    worker.terminate()
    worker = undefined
    const stats = await fs.promises.stat(dbPath)
    expect(stats.size).toBe('locked sqlite bytes'.length)
  })

  it('mounts while a SQLite-style journal is created and removed during the walk', async () => {
    worker = await startLockWorker(`/${testDir}/db/seed.db-journal`, 'churn')
    // Without per-entry tolerance, roughly 1 in 12 walks lands between listing and removal.
    for (let i = 0; i < 40; i++) {
      await new BrowserFileManager().initializeFileSystem()
    }
  })

  it('throws FileSystemLockedError (OPFS_LOCKED) when the root stays unreadable', async () => {
    const unreadableRoot = {
      kind: 'directory',
      name: '',
      async *entries() {
        throw new DOMException('state changed', 'InvalidStateError')
      },
    } as unknown as FileSystemDirectoryHandle
    const spy = vi.spyOn(navigator.storage, 'getDirectory').mockResolvedValue(unreadableRoot)
    try {
      const error = await new BrowserFileManager().initializeFileSystem().catch((e) => e)
      expect(error).toBeInstanceOf(FileSystemLockedError)
      expect(error.code).toBe('OPFS_LOCKED')
      expect((error.cause as DOMException).name).toBe('InvalidStateError')
      expect(spy.mock.calls.length).toBeGreaterThan(1)
    } finally {
      spy.mockRestore()
    }
  })
})
