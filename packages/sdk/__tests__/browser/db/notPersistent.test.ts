import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
