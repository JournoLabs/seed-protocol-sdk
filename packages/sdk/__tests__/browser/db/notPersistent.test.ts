import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BrowserDb } from '@/browser/db/Db'
import { BaseFileManager } from '@/helpers'
import { DatabaseNotPersistentError } from '@/helpers/FileManager/errors'

describe('BrowserDb.prepareDb without SharedArrayBuffer', () => {
  const filesDir = `/not-persistent-${Math.random().toString(36).slice(2, 10)}`
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer')

  beforeAll(async () => {
    const { configurePlatform } = await import('@/platform/configurePlatform')
    const { createPlatformServices } = await import('@/platform/index.browser')
    configurePlatform(createPlatformServices())
    await BaseFileManager.initializeFileSystem()
  })

  afterAll(async () => {
    if (descriptor) Object.defineProperty(globalThis, 'SharedArrayBuffer', descriptor)
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(filesDir.slice(1), { recursive: true }).catch(() => {})
  })

  it('throws DatabaseNotPersistentError instead of opening an in-memory database', async () => {
    // Pages that aren't cross-origin isolated have no SharedArrayBuffer global.
    Object.defineProperty(globalThis, 'SharedArrayBuffer', { value: undefined, configurable: true, writable: true })

    const db = new BrowserDb()
    const error = await db.prepareDb(filesDir).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DatabaseNotPersistentError)
    expect((error as DatabaseNotPersistentError).code).toBe('DB_NOT_PERSISTENT')
    expect(db.sqlocalInstance).toBeUndefined()
    expect(db.isAppDbReady()).toBe(false)
  })
})

describe('BrowserDb.prepareDb when the OPFS VFS fails to install', () => {
  const filesDir = `/not-persistent-vfs-${Math.random().toString(36).slice(2, 10)}`
  const OriginalWorker = globalThis.Worker

  beforeAll(async () => {
    const { configurePlatform } = await import('@/platform/configurePlatform')
    const { createPlatformServices } = await import('@/platform/index.browser')
    configurePlatform(createPlatformServices())
    await BaseFileManager.initializeFileSystem()
  })

  afterEach(() => {
    globalThis.Worker = OriginalWorker
  })

  afterAll(async () => {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(filesDir.slice(1), { recursive: true }).catch(() => {})
  })

  it('names the VFS install, not the headers, on a cross-origin isolated page', async () => {
    expect(globalThis.crossOriginIsolated).toBe(true)

    // Inside sqlocal's worker, refuse every nested worker, as the Chromium builds in the PermaPress
    // report do for http(s) URLs. SQLite then can't start its OPFS proxy and SQLocal opens memory.
    const refuseNested = URL.createObjectURL(
      new Blob(["self.Worker = function () { throw new Error('nested worker refused') };"], {
        type: 'text/javascript',
      }),
    )
    function RefusingWorker(scriptURL: string | URL, options?: WorkerOptions): Worker {
      if (options?.type !== 'module') return new OriginalWorker(scriptURL, options)
      const source = `import ${JSON.stringify(refuseNested)};\nimport ${JSON.stringify(String(scriptURL))};`
      return new OriginalWorker(
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
        options,
      )
    }
    RefusingWorker.prototype = OriginalWorker.prototype
    globalThis.Worker = RefusingWorker as unknown as typeof Worker

    const db = new BrowserDb()
    const error = await db.prepareDb(filesDir).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DatabaseNotPersistentError)
    const message = (error as Error).message
    expect(message).toMatch(/opened a "memory" database/)
    expect(message).toMatch(/OPFS VFS failed to install/)
    expect(message).not.toMatch(/Cross-Origin-Opener-Policy/)
    await db.sqlocalInstance?.destroy().catch(() => {})
  })
})
