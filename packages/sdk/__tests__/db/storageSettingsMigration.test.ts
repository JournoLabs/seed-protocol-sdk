import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type Client } from '@libsql/client'

/**
 * Migration 0018 adds the storage settings columns to `properties` and fills them for existing
 * rows from the schema file content stored in `schemas.schema_data`.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const drizzleDir = path.resolve(here, '../../src/db/drizzle')
const journal = JSON.parse(
  fs.readFileSync(path.join(drizzleDir, 'meta/_journal.json'), 'utf-8'),
) as { entries: { tag: string }[] }

const runMigration = async (client: Client, tag: string) => {
  const sql = fs.readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf-8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.execute(statement)
  }
}

const migrateUpTo = async (client: Client, lastTag: string) => {
  for (const { tag } of journal.entries) {
    await runMigration(client, tag)
    if (tag === lastTag) return
  }
  throw new Error(`no migration ${lastTag}`)
}

describe('migration 0018: storage settings on properties', () => {
  it('backfills storage settings from the stored schema file', async () => {
    const client = createClient({ url: ':memory:' })
    await migrateUpTo(client, '0017_add_revoked_at_to_versions')

    const schemaData = JSON.stringify({
      models: {
        Zine: {
          properties: {
            title: { type: 'Text' },
            html: { type: 'Text', storage: { type: 'ItemStorage', path: '/html', extension: '.html' } },
            attachment: { type: 'File', storage: { type: 'PropertyStorage', path: '/files' } },
            // Internal (pre-conversion) shape, as some stored schema files have it.
            body: { dataType: 'Text', storageType: 'ItemStorage', localStorageDir: '/body', filenameSuffix: '.md' },
          },
        },
      },
    })
    await client.execute({
      sql: `INSERT INTO schemas (id, name, version, created_at, updated_at, schema_data) VALUES (1, 's', 1, 0, 0, ?)`,
      args: [schemaData],
    })
    // A schema whose data isn't valid JSON must not break the migration.
    await client.execute(
      `INSERT INTO schemas (id, name, version, created_at, updated_at, schema_data) VALUES (2, 'broken', 1, 0, 0, '{not json')`,
    )
    await client.execute(`INSERT INTO models (id, name) VALUES (1, 'Zine'), (2, 'Orphan')`)
    await client.execute(`INSERT INTO model_schemas (model_id, schema_id) VALUES (1, 1), (1, 2), (2, 2)`)
    await client.execute(`
      INSERT INTO properties (id, name, data_type, model_id) VALUES
        (1, 'title', 'Text', 1),
        (2, 'html', 'Text', 1),
        (3, 'attachment', 'File', 1),
        (4, 'body', 'Text', 1),
        (5, 'notInFile', 'Text', 1),
        (6, 'html', 'Text', 2)
    `)

    await runMigration(client, '0018_add_storage_settings_to_properties')

    const { rows } = await client.execute(
      `SELECT id, storage_type, local_storage_dir, filename_suffix FROM properties ORDER BY id`,
    )
    expect(rows.map((r) => [r.id, r.storage_type, r.local_storage_dir, r.filename_suffix])).toEqual([
      [1, null, null, null],
      [2, 'ItemStorage', '/html', '.html'],
      [3, 'PropertyStorage', '/files', null],
      [4, 'ItemStorage', '/body', '.md'],
      [5, null, null, null],
      [6, null, null, null],
    ])
    client.close()
  })
})
