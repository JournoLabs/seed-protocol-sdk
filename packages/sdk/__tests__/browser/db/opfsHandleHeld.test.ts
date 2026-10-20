import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BrowserDb } from '@/browser/db/Db'
import { BaseFileManager } from '@/helpers'

/**
 * Another tab holding seed.db's sync access handle (as it does while running queries) for longer
 * than sqlite-wasm retries makes SQLocal fall back to an in-memory database. prepareDb reopens
 * until the handle is free instead of failing with DatabaseNotPersistentError.
 */
const holdHandleWorkerSource = `
self.onmessage = async ({ data: { dir, holdMs } }) => {
  let handle = await navigator.storage.getDirectory()
  for (const part of dir.split('/').filter(Boolean)) handle = await handle.getDirectoryHandle(part, { create: true })
  const file = await handle.getFileHandle('seed.db', { create: true })
  const access = await file.createSyncAccessHandle()
  self.postMessage('held')
  setTimeout(() => { access.close(); self.postMessage('released') }, holdMs)
}
`

describe('BrowserDb.prepareDb while another context holds seed.db', () => {
  const filesDir = `/opfs-held-${Math.random().toString(36).slice(2, 10)}`
  let worker: Worker | undefined
  let db: BrowserDb | undefined

  beforeAll(async () => {
    const { configurePlatform } = await import('@/platform/configurePlatform')
    const { createPlatformServices } = await import('@/platform/index.browser')
    configurePlatform(createPlatformServices())
    await BaseFileManager.initializeFileSystem()
  })

  afterAll(async () => {
    await db?.sqlocalInstance?.destroy().catch(() => {})
    worker?.terminate()
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(filesDir.slice(1), { recursive: true }).catch(() => {})
  })

  it('opens the OPFS database once the handle is released', async () => {
    worker = new Worker(URL.createObjectURL(new Blob([holdHandleWorkerSource], { type: 'text/javascript' })))
    const messages: string[] = []
    const held = new Promise<void>((resolve) => {
      worker!.onmessage = ({ data }) => {
        messages.push(data)
        if (data === 'held') resolve()
      }
    })
    worker.postMessage({ dir: `${filesDir}/db`, holdMs: 7000 })
    await held

    db = new BrowserDb()
    await db.prepareDb(filesDir)

    expect(messages).toContain('released')
    expect((await db.sqlocalInstance!.getDatabaseInfo()).storageType).toBe('opfs')
    expect(db.isAppDbReady()).toBe(true)
  }, 60000)
})
