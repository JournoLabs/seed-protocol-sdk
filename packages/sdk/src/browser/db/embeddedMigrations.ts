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
 * Applies one migration's statements, including the row that records it in the migrations table.
 * Pass an atomic runner (a transaction) so a crash or a racing tab can't leave it half-applied.
 */
export type MigrationRunner = (queries: string[], migration: EmbeddedMigration) => Promise<void>

/** SQLite ignores `PRAGMA foreign_keys` inside a transaction, so such migrations must run outside one. */
export function canRunInTransaction(migration: EmbeddedMigration): boolean {
  return !migration.sql.some((query) => /^\s*PRAGMA\s+foreign_keys\b/im.test(query))
}

/**
 * Same apply loop as drizzle-orm/sqlite-proxy/migrator, with in-memory migrations. Callers sharing
 * the database across tabs must hold a cross-tab lock: the read of the last applied migration and
 * the writes that follow aren't atomic.
 */
export async function applyEmbeddedMigrations(
  db: SqliteRemoteDatabase<Record<string, unknown>>,
  migrations: EmbeddedMigration[],
  migrationsTable = '__drizzle_migrations',
  runMigration?: MigrationRunner,
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

  const runSequentially: MigrationRunner = async (queries) => {
    for (const query of queries) {
      await db.run(sql.raw(query))
    }
  }

  for (const migration of migrations) {
    if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) {
      const queries = [
        ...migration.sql,
        `INSERT INTO \`${migrationsTable}\` ("hash", "created_at") VALUES('${migration.hash}', '${migration.folderMillis}')`,
      ]
      await (runMigration ?? runSequentially)(queries, migration)
    }
  }
}
