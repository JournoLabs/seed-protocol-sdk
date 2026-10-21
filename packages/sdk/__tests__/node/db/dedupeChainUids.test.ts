// @vitest-environment node
/**
 * Migration 0029: merges duplicate seeds / versions rows of one attested uid and duplicate
 * model_schemas links, then adds the unique indexes (SDK audit T9).
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { resolveSdkDrizzleMigrationsDir } from '@/node/db/Db'

const MIGRATION_TAG = '0029_dedupe_chain_uids_add_unique_indexes'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-dedupe-uids-'))

/** A migrations folder holding the migrations before `tag`. */
const migrationsFolderBefore = (tag: string): string => {
  const source = resolveSdkDrizzleMigrationsDir()
  const target = path.join(tempDir(), 'drizzle')
  fs.mkdirSync(path.join(target, 'meta'), { recursive: true })
  const journal = JSON.parse(fs.readFileSync(path.join(source, 'meta', '_journal.json'), 'utf-8'))
  const index = journal.entries.findIndex((entry: { tag: string }) => entry.tag === tag)
  expect(index).toBeGreaterThan(0)
  journal.entries = journal.entries.slice(0, index)
  fs.writeFileSync(path.join(target, 'meta', '_journal.json'), JSON.stringify(journal))
  for (const { tag: entryTag } of journal.entries) {
    fs.copyFileSync(path.join(source, `${entryTag}.sql`), path.join(target, `${entryTag}.sql`))
  }
  return target
}

const uid = (byte: string) => '0x' + byte.repeat(32)
const ZERO = '0x' + '0'.repeat(64)

const setup = async () => {
  const client = createClient({ url: `file:${path.join(tempDir(), 'seed.db')}` })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: migrationsFolderBefore(MIGRATION_TAG) })
  const run = (sql: string, args: (string | number | null)[] = []) => client.execute({ sql, args })
  const rows = async (sql: string) => (await client.execute(sql)).rows.map((row) => ({ ...row }))
  return { client, db, run, rows }
}

describe(`migration ${MIGRATION_TAG}`, () => {
  it('merges duplicate seeds into the one with versions and moves their references', async () => {
    const { client, db, run, rows } = await setup()
    // The item publish recorded the uid on; it has the local versions.
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['item0001', uid('a1'), 'post', 100])
    await run('INSERT INTO versions (local_id, seed_local_id, seed_uid, uid, seed_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['ver0001', 'item0001', uid('a1'), uid('a2'), 'post', 100])
    await run('INSERT INTO metadata (local_id, seed_local_id, version_local_id, property_name, property_value, uid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['meta0001', 'item0001', 'ver0001', 'title', 'Hi', uid('a3'), 100])
    // A second row sync inserted for the same uid, with a column the item lacks, a version of its
    // own, a copy of the item's property row and a property row the item doesn't have.
    await run('INSERT INTO seeds (local_id, uid, type, model_file_id, attestation_raw, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['dup00001', uid('a1'), 'post', 'model001', '{"id":1}', 200])
    await run('INSERT INTO versions (local_id, seed_local_id, seed_uid, uid, seed_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['ver0002', 'dup00001', uid('a1'), uid('b2'), 'post', 200])
    await run('INSERT INTO metadata (local_id, seed_local_id, version_local_id, property_name, property_value, uid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['meta0002', 'dup00001', 'ver0002', 'title', 'Hi', uid('a3'), 200])
    await run('INSERT INTO metadata (local_id, seed_local_id, version_local_id, property_name, property_value, uid, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['meta0003', 'dup00001', 'ver0002', 'body', 'Text', uid('b3'), 200])
    await run("INSERT INTO pending_writes (op_id, seed_local_id, kind, created_at, status) VALUES ('op000001', 'dup00001', 'update', 300, 'pending')")
    await run("INSERT INTO publish_processes (seed_local_id, model_name, status, started_at, persisted_snapshot) VALUES ('dup00001', 'Post', 'completed', 300, '{}')")
    // Drafts: placeholder uids are not unique and stay.
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['draft001', null, 'post', 100])
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['draft002', null, 'post', 100])
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['draft003', ZERO, 'post', 100])
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['draft004', ZERO, 'post', 100])
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['draft005', 'NULL', 'post', 100])

    await migrate(db, { migrationsFolder: resolveSdkDrizzleMigrationsDir() })

    expect(await rows('SELECT local_id, uid, model_file_id, attestation_raw FROM seeds ORDER BY local_id')).toEqual([
      { local_id: 'draft001', uid: null, model_file_id: null, attestation_raw: null },
      { local_id: 'draft002', uid: null, model_file_id: null, attestation_raw: null },
      { local_id: 'draft003', uid: ZERO, model_file_id: null, attestation_raw: null },
      { local_id: 'draft004', uid: ZERO, model_file_id: null, attestation_raw: null },
      { local_id: 'draft005', uid: 'NULL', model_file_id: null, attestation_raw: null },
      { local_id: 'item0001', uid: uid('a1'), model_file_id: 'model001', attestation_raw: '{"id":1}' },
    ])
    expect(await rows('SELECT local_id, seed_local_id FROM versions ORDER BY local_id')).toEqual([
      { local_id: 'ver0001', seed_local_id: 'item0001' },
      { local_id: 'ver0002', seed_local_id: 'item0001' },
    ])
    // The copy of the item's row is dropped; the other row moves.
    expect(await rows('SELECT local_id, seed_local_id FROM metadata ORDER BY local_id')).toEqual([
      { local_id: 'meta0001', seed_local_id: 'item0001' },
      { local_id: 'meta0003', seed_local_id: 'item0001' },
    ])
    expect(await rows('SELECT seed_local_id FROM pending_writes')).toEqual([{ seed_local_id: 'item0001' }])
    expect(await rows('SELECT seed_local_id FROM publish_processes')).toEqual([{ seed_local_id: 'item0001' }])
    expect(await rows("SELECT name FROM sqlite_master WHERE name LIKE '__t9_%'")).toEqual([])

    // The index now refuses a second row of an attested uid, and still takes placeholders.
    await expect(run('INSERT INTO seeds (local_id, uid) VALUES (?, ?)', ['dup00002', uid('a1')])).rejects.toThrow(/UNIQUE/)
    await run('INSERT INTO seeds (local_id, uid) VALUES (?, ?)', ['draft006', ZERO])
    client.close()
  })

  it('merges duplicate versions into the one with property rows', async () => {
    const { client, db, run, rows } = await setup()
    await run('INSERT INTO seeds (local_id, uid, type, created_at) VALUES (?, ?, ?, ?)', ['item0001', uid('a1'), 'post', 100])
    // Publish stamped the uid on the local version; sync inserted a second (older) row for it.
    await run('INSERT INTO versions (local_id, seed_local_id, uid, seed_type, created_at) VALUES (?, ?, ?, ?, ?)', ['ver0001', 'item0001', uid('a2'), 'post', 100])
    await run('INSERT INTO versions (local_id, seed_local_id, seed_uid, uid, seed_type, attestation_raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', ['ver0002', 'item0001', uid('a1'), uid('a2'), 'post', '{"id":2}', 50])
    await run('INSERT INTO metadata (local_id, seed_local_id, version_local_id, property_name, uid, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['meta0001', 'item0001', 'ver0001', 'title', uid('a3'), 100])
    await run('INSERT INTO versions (local_id, seed_local_id, uid, created_at) VALUES (?, ?, ?, ?)', ['draft001', 'item0001', null, 300])
    await run('INSERT INTO versions (local_id, seed_local_id, uid, created_at) VALUES (?, ?, ?, ?)', ['draft002', 'item0001', null, 300])

    await migrate(db, { migrationsFolder: resolveSdkDrizzleMigrationsDir() })

    expect(await rows('SELECT local_id, uid, seed_uid, attestation_raw FROM versions ORDER BY local_id')).toEqual([
      { local_id: 'draft001', uid: null, seed_uid: null, attestation_raw: null },
      { local_id: 'draft002', uid: null, seed_uid: null, attestation_raw: null },
      { local_id: 'ver0001', uid: uid('a2'), seed_uid: uid('a1'), attestation_raw: '{"id":2}' },
    ])
    expect(await rows('SELECT local_id, version_local_id FROM metadata ORDER BY local_id')).toEqual([
      { local_id: 'meta0001', version_local_id: 'ver0001' },
    ])
    client.close()
  })

  it('keeps one model_schemas link per model and schema', async () => {
    const { client, db, run, rows } = await setup()
    await run("INSERT INTO schemas (id, name, version) VALUES (1, 'Blog', 1), (2, 'Other', 1)")
    await run("INSERT INTO models (id, name) VALUES (1, 'Post'), (2, 'Author')")
    await run('INSERT INTO model_schemas (id, model_id, schema_id) VALUES (1, 1, 1), (2, 1, 1), (3, 2, 1), (4, 1, 2), (5, 1, 1)')

    await migrate(db, { migrationsFolder: resolveSdkDrizzleMigrationsDir() })

    expect(await rows('SELECT id, model_id, schema_id FROM model_schemas ORDER BY id')).toEqual([
      { id: 1, model_id: 1, schema_id: 1 },
      { id: 3, model_id: 2, schema_id: 1 },
      { id: 4, model_id: 1, schema_id: 2 },
    ])
    await expect(run('INSERT INTO model_schemas (model_id, schema_id) VALUES (2, 1)')).rejects.toThrow(/UNIQUE/)
    client.close()
  })
})
