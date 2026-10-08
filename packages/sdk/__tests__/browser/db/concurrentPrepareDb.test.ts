import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { BrowserDb } from '@/browser/db/Db'
import { getEmbeddedMigrations } from '@/browser/db/embeddedMigrations'
import { BaseFileManager } from '@/helpers'

/**
 * Two BrowserDb instances each start their own SQLocal worker, i.e. their own SQLite connection,
 * like two tabs opening the app at the same time against a fresh database.
 */
describe('BrowserDb.prepareDb from two tabs at once', () => {
  const filesDir = `/concurrent-prepare-${Math.random().toString(36).slice(2, 10)}`
  const instances: BrowserDb[] = []

  beforeAll(async () => {
    const { configurePlatform } = await import('@/platform/configurePlatform')
    const { createPlatformServices } = await import('@/platform/index.browser')
    configurePlatform(createPlatformServices())
    await BaseFileManager.initializeFileSystem()
  })

  afterAll(async () => {
    for (const instance of instances) {
      await instance.sqlocalInstance?.destroy?.()
    }
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(filesDir.slice(1), { recursive: true }).catch(() => {})
  })

  it('applies every migration exactly once', async () => {
    // Without OPFS persistence SQLocal falls back to separate in-memory databases.
    expect(globalThis.crossOriginIsolated).toBe(true)

    instances.push(new BrowserDb(), new BrowserDb())
    const [dbA, dbB] = await Promise.all(instances.map((instance) => instance.prepareDb(filesDir)))
    expect(dbA).toBeDefined()
    expect(dbB).toBeDefined()

    const applied = await dbA!.values<[number]>(sql`SELECT COUNT(*) FROM __drizzle_migrations`)
    expect(Number(applied[0][0])).toBe(getEmbeddedMigrations().length)

    // Both connections see the same, fully migrated database.
    const tables = await dbB!.values<[string]>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publish_processes'`,
    )
    expect(tables).toHaveLength(1)
  })
})
