// @vitest-environment node
/**
 * Migration 0027: links metadata rows written without property_id to their property through the
 * seed's model (decision D4), so readers can match them by id.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { resolveSdkDrizzleMigrationsDir } from '@/node/db/Db'

const MIGRATIONS_BEFORE_0027 = 27

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'seed-property-ids-'))

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

describe('migration 0027_link_metadata_property_ids', () => {
  it('links rows by key and stored forms through seeds.model_file_id, leaving the rest NULL', async () => {
    const client = createClient({ url: `file:${path.join(tempDir(), 'seed.db')}` })
    const db = drizzle(client)
    await migrate(db, { migrationsFolder: migrationsFolder(MIGRATIONS_BEFORE_0027) })

    const now = Date.now()
    const run = (sql: string, args: (string | number | null)[]) => client.execute({ sql, args })
    await run('INSERT INTO models (id, name, schema_file_id) VALUES (?, ?, ?)', [1, 'Publication', 'pub-model'])
    await run('INSERT INTO models (id, name, schema_file_id) VALUES (?, ?, ?)', [2, 'Identity', 'identity-model'])
    await run('INSERT INTO models (id, name, schema_file_id) VALUES (?, ?, ?)', [3, 'Category', 'category-model'])
    const property = (id: number, name: string, dataType: string, refModelId: number | null, refValueType: string | null) =>
      run(
        'INSERT INTO properties (id, name, data_type, model_id, ref_model_id, ref_value_type, schema_file_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, name, dataType, 1, refModelId, refValueType, `prop-${id}`],
      )
    await property(10, 'title', 'Text', null, null)
    await property(11, 'admins', 'List', 2, 'Relation')
    await property(12, 'owner', 'Relation', 2, null)
    await property(13, 'cover', 'Image', null, null)
    await property(14, 'categories', 'List', 3, 'Relation')

    await run('INSERT INTO seeds (local_id, type, model_file_id, created_at) VALUES (?, ?, ?, ?)', ['pub00001', 'publication', 'pub-model', now])
    // A synced seed: no model_file_id, so its rows aren't linked.
    await run('INSERT INTO seeds (local_id, type, created_at) VALUES (?, ?, ?)', ['synced01', 'publication', now])

    const row = (localId: string, seedLocalId: string, propertyName: string, propertyId: number | null = null) =>
      run(
        'INSERT INTO metadata (local_id, seed_local_id, property_name, property_id, property_value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [localId, seedLocalId, propertyName, propertyId, 'v', now],
      )
    await row('m-title', 'pub00001', 'title')
    await row('m-admins', 'pub00001', 'adminIdentityIds')
    await row('m-owner-key', 'pub00001', 'owner')
    await row('m-owner-id', 'pub00001', 'ownerId')
    await row('m-cover', 'pub00001', 'coverId')
    await row('m-cats', 'pub00001', 'categoryCategoryIds')
    await row('m-gone', 'pub00001', 'removedProperty')
    await row('m-linked', 'pub00001', 'title', 11)
    await row('m-synced', 'synced01', 'title')

    await migrate(db, { migrationsFolder: resolveSdkDrizzleMigrationsDir() })

    const linked = Object.fromEntries(
      (await client.execute('SELECT local_id, property_id FROM metadata')).rows.map((r: any) => [r.local_id, r.property_id]),
    )
    expect(linked).toEqual({
      'm-title': 10,
      'm-admins': 11,
      'm-owner-key': 12,
      'm-owner-id': 12,
      'm-cover': 13,
      'm-cats': 14,
      'm-gone': null,
      // Rows that already have one keep it
      'm-linked': 11,
      'm-synced': null,
    })
    client.close()
  })
})
