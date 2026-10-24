// @vitest-environment node
/**
 * Decision D1 (SDK audit 2026-10): a database written by an SDK older than 0.7.7 is recreated when
 * opened, so its unpublished rows are gone; a 0.7.7 or newer database is opened as it is. A 0.7.7
 * database can look older (its marker is written by a background task), so the old database is
 * copied next to it first, and kept as it is when the copy fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { NodeDb, resolveSdkDrizzleMigrationsDir } from '@/node/db/Db'
import {
  MIN_VERSION_APP_STATE_KEY,
  recreateIfOlderThanMinimumUpgradeVersion,
} from '@/db/minimumUpgradeVersion'

/** Migrations 0000-0019: what SDKs 0.7.2 to 0.7.7 all ship. */
const MIGRATIONS_UP_TO_0_7_7 = 20

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-min-upgrade-'))

/** A migrations folder holding only the first `count` migrations. */
const migrationsFolder = (count: number): string => {
  const source = resolveSdkDrizzleMigrationsDir()
  const target = path.join(tempDir(), 'drizzle')
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta', '_journal.json'), 'utf-8'))
  journal.entries = journal.entries.slice(0, count)
  fs.writeFileSync(path.join(target, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const { tag } of journal.entries) {
    fs.copyFileSync(path.join(source, `${tag}.sql`), path.join(target, `${tag}.sql`))
  }
  return target
}

/** A database file as an older SDK left it: `migrations` applied, one unpublished seed. */
const writeOldDatabase = async (
  dbFile: string,
  { migrations, appStateKeys = [] }: { migrations?: number; appStateKeys?: string[] },
) => {
  const client = createClient({ url: `file:${dbFile}` })
  const db = drizzle(client)
  await migrate(db, {
    migrationsFolder: migrations === undefined ? resolveSdkDrizzleMigrationsDir() : migrationsFolder(migrations),
  })
  await client.execute({
    sql: 'INSERT INTO seeds (local_id, type, created_at) VALUES (?, ?, ?)',
    args: ['draftSeed01', 'post', Date.now()],
  })
  for (const key of appStateKeys) {
    await client.execute({ sql: 'INSERT INTO appState (key, value) VALUES (?, ?)', args: [key, '{}'] })
  }
  client.close()
}

const openWithSdk = async (dbFile: string) => {
  const db = await new NodeDb().prepareDb(path.join(tempDir(), '.seed'), {
    dbUrl: dbFile,
    outDir: path.join(tempDir(), 'migrations'),
  })
  const seedRows = (await db.$client.execute('SELECT local_id FROM seeds')).rows.map((row: any) => row.local_id)
  const applied = Number((await db.$client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0].n)
  return { seedRows, applied }
}

/** Local ids of the seeds in a database file, opened without the SDK. */
const seedIdsIn = async (dbFile: string): Promise<string[]> => {
  const client = createClient({ url: `file:${dbFile}` })
  try {
    return (await client.execute('SELECT local_id FROM seeds')).rows.map((row: any) => row.local_id)
  } finally {
    client.close()
  }
}

const totalMigrations = () =>
  JSON.parse(fs.readFileSync(path.join(resolveSdkDrizzleMigrationsDir(), 'meta', '_journal.json'), 'utf-8'))
    .entries.length as number

describe('minimum upgrade-from version (0.7.7)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('recreates a database an SDK older than 0.7.7 wrote, dropping its unpublished rows', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    await writeOldDatabase(dbFile, { migrations: MIGRATIONS_UP_TO_0_7_7 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { seedRows, applied } = await openWithSdk(dbFile)

    expect(seedRows).toEqual([])
    expect(applied).toBe(totalMigrations())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('older than 0.7.7'))
  })

  it('copies the old database next to it before recreating it, drafts included', async () => {
    const dir = tempDir()
    const dbFile = path.join(dir, 'seed.db')
    await writeOldDatabase(dbFile, { migrations: MIGRATIONS_UP_TO_0_7_7 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await openWithSdk(dbFile)

    const backups = fs.readdirSync(dir).filter((name) => /^seed\.before-recreate-\d+\.db$/.test(name))
    expect(backups).toHaveLength(1)
    expect(await seedIdsIn(path.join(dir, backups[0]!))).toEqual(['draftSeed01'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(backups[0]!))
  })

  it('keeps an old database as it is when the copy fails', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    await writeOldDatabase(dbFile, { migrations: MIGRATIONS_UP_TO_0_7_7 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createClient({ url: `file:${dbFile}` })
    try {
      const recreated = await recreateIfOlderThanMinimumUpgradeVersion(drizzle(client), {
        backupPath: path.join(tempDir(), 'missing-folder', 'copy.db'),
      })
      expect(recreated).toBe(false)
    } finally {
      client.close()
    }

    expect(await seedIdsIn(dbFile)).toEqual(['draftSeed01'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('opened as it is'), expect.anything())
  })

  it('keeps an old database as it is when there is nowhere to copy it', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    await writeOldDatabase(dbFile, { migrations: MIGRATIONS_UP_TO_0_7_7 })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createClient({ url: `file:${dbFile}` })
    try {
      expect(await recreateIfOlderThanMinimumUpgradeVersion(drizzle(client))).toBe(false)
    } finally {
      client.close()
    }

    expect(await seedIdsIn(dbFile)).toEqual(['draftSeed01'])
  })

  it('recreates a database older than 0.7.2 too', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    await writeOldDatabase(dbFile, { migrations: 16 })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect((await openWithSdk(dbFile)).seedRows).toEqual([])
  })

  it('keeps a database 0.7.7 wrote (same migrations, with its init marker)', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    await writeOldDatabase(dbFile, {
      migrations: MIGRATIONS_UP_TO_0_7_7,
      appStateKeys: [MIN_VERSION_APP_STATE_KEY],
    })

    const { seedRows, applied } = await openWithSdk(dbFile)

    expect(seedRows).toEqual(['draftSeed01'])
    expect(applied).toBe(totalMigrations())
  })

  it('keeps a database a newer SDK migrated', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    await writeOldDatabase(dbFile, {})

    const { seedRows } = await openWithSdk(dbFile)

    expect(seedRows).toEqual(['draftSeed01'])
  })

  it('opens a new database as a fresh install', async () => {
    const dbFile = path.join(tempDir(), 'seed.db')
    const { seedRows, applied } = await openWithSdk(dbFile)
    expect(seedRows).toEqual([])
    expect(applied).toBe(totalMigrations())
  })
})
