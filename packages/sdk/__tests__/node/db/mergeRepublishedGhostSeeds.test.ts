// @vitest-environment node
/**
 * Migration 0024: removes the second seed row an older sync inserted for a republished item's old
 * uid (SDK audit 1.7), and moves property rows sync attached to it onto the item.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { resolveSdkDrizzleMigrationsDir } from '@/node/db/Db'

const MIGRATIONS_BEFORE_0024 = 24

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-ghost-seeds-'))

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

const uid = (byte: string) => '0x' + byte.repeat(32)

describe('migration 0024_merge_republished_ghost_seeds', () => {
  it('deletes version-less seed rows whose uid is another seed\'s history, keeping other rows', async () => {
    const client = createClient({ url: `file:${path.join(tempDir(), 'seed.db')}` })
    const db = drizzle(client)
    await migrate(db, { migrationsFolder: migrationsFolder(MIGRATIONS_BEFORE_0024) })

    const now = Date.now()
    const run = (sql: string, args: (string | number | null)[]) => client.execute({ sql, args })
    // The republished item: seed row holds the new uid; its old version still records the old one.
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['item0001', uid('b2'), 'post', now])
    await run('INSERT INTO versions (local_id, seed_local_id, seed_uid, uid, seed_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['ver0001', 'item0001', uid('a1'), uid('a3'), 'post', now])
    await run('INSERT INTO versions (local_id, seed_local_id, seed_uid, uid, seed_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['ver0002', 'item0001', uid('b2'), uid('b3'), 'post', now])
    // The ghost row sync inserted for the old uid, and a property row sync attached to it.
    await run('INSERT INTO seeds (local_id, uid, type, revoked_at, created_at) VALUES (?, ?, ?, ?, ?)', ['ghost001', uid('a1'), 'post', 1000, now])
    await run('INSERT INTO metadata (local_id, seed_local_id, version_local_id, property_name, property_value, uid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['meta0001', 'ghost001', 'ver0001', 'title', 'Old', uid('a4'), now])
    // A published seed without local versions (nothing records its uid): kept.
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['bare0001', uid('c1'), 'post', now])
    // A draft seed: kept.
    await run('INSERT INTO seeds (local_id, type, created_at) VALUES (?, ?, ?)', ['draft001', 'post', now])

    await migrate(db, { migrationsFolder: resolveSdkDrizzleMigrationsDir() })

    const seedIds = (await client.execute('SELECT local_id FROM seeds ORDER BY local_id')).rows.map((r: any) => r.local_id)
    expect(seedIds).toEqual(['bare0001', 'draft001', 'item0001'])
    const meta = (await client.execute("SELECT seed_local_id FROM metadata WHERE local_id = 'meta0001'")).rows
    expect(meta.map((r: any) => r.seed_local_id)).toEqual(['item0001'])
    client.close()
  })
})
