// @vitest-environment node
/**
 * libsql 0.5 doesn't reset a statement that failed with SQLITE_BUSY: its connection stays in an
 * implicit transaction that never commits (inTransaction still reads false), so every later write on
 * it, a busy retry's included, is lost when the connection closes, and other connections never see
 * it. Busy errors come from another process (here a second client) holding the file's lock, and
 * before singleConnectionTransactions from libsql's own transaction(), which hands its connection to
 * the transaction and opens another for later statements.
 */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { eq } from 'drizzle-orm'
import { NodeDb } from '@/node/db/Db'
import { appState } from '@/seedSchema'

describe('NodeDb writes after SQLITE_BUSY', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  it('commits a write that was retried after SQLITE_BUSY, and the writes after it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-busy-connection-'))
    roots.push(root)
    const dbFile = path.join(root, 'app.db')
    const nodeDb = new NodeDb()
    await nodeDb.prepareDb(path.join(root, '.seed'), { dbUrl: dbFile })

    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const transaction = nodeDb.transaction(async (tx) => {
      await tx.insert(appState).values({ key: 'in-tx', value: '1' })
      await held
    })
    // Runs now (Drizzle queries are lazy until run), on the connection libsql opens after handing its
    // first one to the transaction: busy, then retried
    const duringTransaction = nodeDb.db.insert(appState).values({ key: 'during-tx', value: '2' }).run()
    setTimeout(release, 50)
    await transaction
    await duringTransaction
    await nodeDb.db.insert(appState).values({ key: 'after-tx', value: '3' })

    // Another connection, as another process or a later client would read the file
    const other = createClient({ url: `file:${dbFile}` })
    try {
      const keys = (await other.execute('SELECT key FROM appState ORDER BY key')).rows.map((row) => row.key)
      expect(keys).toEqual(['after-tx', 'during-tx', 'in-tx'])
    } finally {
      other.close()
    }
    expect(await nodeDb.db.select().from(appState).where(eq(appState.key, 'after-tx'))).toHaveLength(1)
  })
  it('commits writes after one was retried because another connection held the lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-busy-connection-'))
    roots.push(root)
    const dbFile = path.join(root, 'app.db')
    const nodeDb = new NodeDb()
    await nodeDb.prepareDb(path.join(root, '.seed'), { dbUrl: dbFile })

    // Another process (or client) on the same file holds the write lock for a moment
    const other = createClient({ url: `file:${dbFile}` })
    const otherTx = await other.transaction('write')
    await otherTx.execute("INSERT INTO appState (key, value) VALUES ('other', '0')")
    const retried = nodeDb.db.insert(appState).values({ key: 'retried', value: '1' }).run()
    setTimeout(() => { void otherTx.commit() }, 50)
    await retried
    await nodeDb.db.insert(appState).values({ key: 'after', value: '2' })

    const reader = createClient({ url: `file:${dbFile}` })
    try {
      const keys = (await reader.execute('SELECT key FROM appState ORDER BY key')).rows.map((row) => row.key)
      expect(keys).toEqual(['after', 'other', 'retried'])
    } finally {
      reader.close()
      other.close()
    }
  })
  it('commits writes after a transaction failed to begin because another connection held the lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-busy-connection-'))
    roots.push(root)
    const dbFile = path.join(root, 'app.db')
    const nodeDb = new NodeDb()
    await nodeDb.prepareDb(path.join(root, '.seed'), { dbUrl: dbFile })

    const other = createClient({ url: `file:${dbFile}` })
    const otherTx = await other.transaction('write')
    // BaseDb.transaction retries this whole; here the busy error comes straight back
    await expect(
      nodeDb.transaction(async (tx) => {
        await tx.insert(appState).values({ key: 'never', value: '0' })
      }),
    ).rejects.toThrow(/SQLITE_BUSY|locked/)
    await otherTx.commit()
    await nodeDb.db.insert(appState).values({ key: 'after', value: '1' })

    const reader = createClient({ url: `file:${dbFile}` })
    try {
      const keys = (await reader.execute('SELECT key FROM appState ORDER BY key')).rows.map((row) => row.key)
      expect(keys).toEqual(['after'])
    } finally {
      reader.close()
      other.close()
    }
  })
})
