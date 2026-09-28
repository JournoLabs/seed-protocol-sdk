import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { sql } from 'drizzle-orm'
import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import * as drizzleFiles from './drizzleFiles'
import { journalJson } from './drizzleFiles'

export type EmbeddedMigration = {
  sql: string[]
  folderMillis: number
  hash: string
  bps: boolean
}

type JournalEntry = {
  idx: number
  tag: string
  when: number
  breakpoints?: boolean
}

/**
 * Build drizzle migration metadata from embedded SQL strings.
 * Avoids `drizzle-orm/migrator` (Node fs / path / crypto) on the browser graph.
 */
export function getEmbeddedMigrations(): EmbeddedMigration[] {
  const journal = JSON.parse(journalJson) as { entries?: JournalEntry[] }
  const entries = journal.entries ?? []
  return entries.map((entry) => {
    const varName = `migrationSql_${entry.tag}` as keyof typeof drizzleFiles
    const query = drizzleFiles[varName]
    if (typeof query !== 'string') {
      throw new Error(`No embedded migration content for ${entry.tag}`)
    }
    const trimmed = query.trim()
    return {
      sql: trimmed.split('--> statement-breakpoint'),
      bps: Boolean(entry.breakpoints),
      folderMillis: entry.when,
      hash: bytesToHex(sha256(utf8ToBytes(trimmed))),
    }
  })
}

/**
 * Same apply loop as drizzle-orm/sqlite-proxy/migrator, with in-memory migrations.
 */
export async function applyEmbeddedMigrations(
  db: SqliteRemoteDatabase<Record<string, unknown>>,
  migrations: EmbeddedMigration[],
  migrationsTable = '__drizzle_migrations',
): Promise<void> {
  await db.run(sql`
		CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsTable)} (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at numeric
		)
	`)

  const dbMigrations = await db.values(
    sql`SELECT id, hash, created_at FROM ${sql.identifier(migrationsTable)} ORDER BY created_at DESC LIMIT 1`,
  )
  const lastDbMigration = dbMigrations[0] ?? undefined

  const queriesToRun: string[] = []
  for (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) {
      queriesToRun.push(
        ...migration.sql,
        `INSERT INTO \`${migrationsTable}\` ("hash", "created_at") VALUES('${migration.hash}', '${migration.folderMillis}')`,
      )
    }
  }

  for (const query of queriesToRun) {
    await db.run(sql.raw(query))
  }
}
