import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { SQLocalDrizzle } from 'sqlocal/drizzle'
import { BrowserDb } from '@/browser/db/Db'
import { applyEmbeddedMigrations, getEmbeddedMigrations } from '@/browser/db/embeddedMigrations'
import { MIN_VERSION_APP_STATE_KEY } from '@/db/minimumUpgradeVersion'
import { BaseFileManager } from '@/helpers'

/**
 * Decision D1 (SDK audit 2026-10) in the browser: an OPFS database written by an SDK older than
 * 0.7.7 is recreated by prepareDb, so its unpublished rows are gone; a 0.7.7 database is kept. The
 * old database is copied next to seed.db first.
 */

/** Migrations 0000-0019: what SDKs 0.7.2 to 0.7.7 all ship. */
const MIGRATIONS_UP_TO_0_7_7 = 20

const filesDirs: string[] = []
const instances: BrowserDb[] = []

/** An OPFS database as 0.7.7 or older left it: migrations 0000-0019, one unpublished seed. */
const writeOldDatabase = async (appStateKeys: string[] = []): Promise<string> => {
  const filesDir = `/min-upgrade-${Math.random().toString(36).slice(2, 10)}`
  filesDirs.push(filesDir)
  const sqlocal = new SQLocalDrizzle({ databasePath: `${filesDir}/db/seed.db` })
  try {
    const db = drizzle(sqlocal.driver, sqlocal.batchDriver)
    await applyEmbeddedMigrations(db, getEmbeddedMigrations().slice(0, MIGRATIONS_UP_TO_0_7_7))
    await db.run(sql`INSERT INTO seeds (local_id, type, created_at) VALUES ('draftSeed01', 'post', ${Date.now()})`)
    for (const key of appStateKeys) {
      await db.run(sql`INSERT INTO appState (key, value) VALUES (${key}, '{}')`)
    }
  } finally {
    await sqlocal.destroy()
  }
  return filesDir
}

const openWithSdk = async (filesDir: string) => {
  const instance = new BrowserDb()
  instances.push(instance)
  const db = (await instance.prepareDb(filesDir))!
  const seedRows = (await db.values<[string]>(sql`SELECT local_id FROM seeds`)).map(([localId]) => localId)
  const [[applied]] = await db.values<[number]>(sql`SELECT COUNT(*) FROM __drizzle_migrations`)
  return { seedRows, applied: Number(applied) }
}

describe('minimum upgrade-from version (0.7.7) in the browser', () => {
  beforeAll(async () => {
    const { configurePlatform } = await import('@/platform/configurePlatform')
    const { createPlatformServices } = await import('@/platform/index.browser')
    configurePlatform(createPlatformServices())
    await BaseFileManager.initializeFileSystem()
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    for (const instance of instances) {
      await instance.sqlocalInstance?.destroy?.()
    }
    const root = await navigator.storage.getDirectory()
    for (const filesDir of filesDirs) {
      await root.removeEntry(filesDir.slice(1), { recursive: true }).catch(() => {})
    }
  })

  it('recreates a database an SDK older than 0.7.7 wrote, dropping its unpublished rows', async () => {
    expect(globalThis.crossOriginIsolated).toBe(true)
    const filesDir = await writeOldDatabase()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { seedRows, applied } = await openWithSdk(filesDir)

    expect(seedRows).toEqual([])
    expect(applied).toBe(getEmbeddedMigrations().length)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('older than 0.7.7'))
    warn.mockRestore()

    const root = await navigator.storage.getDirectory()
    const dbDir = await (await root.getDirectoryHandle(filesDir.slice(1))).getDirectoryHandle('db')
    const backups: string[] = []
    for await (const name of (dbDir as any).keys() as AsyncIterable<string>) {
      if (/^seed\.before-recreate-\d+\.db$/.test(name)) backups.push(name)
    }
    expect(backups).toHaveLength(1)
    const copy = new SQLocalDrizzle({ databasePath: `${filesDir}/db/${backups[0]}` })
    try {
      const rows = await drizzle(copy.driver, copy.batchDriver).values<[string]>(sql`SELECT local_id FROM seeds`)
      expect(rows.map(([localId]) => localId)).toEqual(['draftSeed01'])
    } finally {
      await copy.destroy()
    }
  })

  it('keeps a database 0.7.7 wrote (same migrations, with its init marker)', async () => {
    const filesDir = await writeOldDatabase([MIN_VERSION_APP_STATE_KEY])

    const { seedRows, applied } = await openWithSdk(filesDir)

    expect(seedRows).toEqual(['draftSeed01'])
    expect(applied).toBe(getEmbeddedMigrations().length)
  })
})
