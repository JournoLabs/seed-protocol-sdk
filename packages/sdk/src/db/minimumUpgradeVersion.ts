import { sql, type SQL } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:db:minimumUpgradeVersion')

/** The oldest SDK whose local database a newer SDK opens as it is. Older ones are recreated. */
export const MIN_UPGRADE_SDK_VERSION = '0.7.7'

/**
 * `when` of migration 0020, the first one 0.7.7 doesn't ship: a database that applied it was opened
 * by 0.7.8 or later. SDKs 0.7.2 to 0.7.7 all ship migrations 0000-0019, so the count alone can't
 * tell 0.7.7 from older.
 */
export const FIRST_MIGRATION_AFTER_MIN_VERSION_MILLIS = 1792354539632

/**
 * appState key that 0.7.7's first init wrote (its stored-display-URL fix) and no older SDK did. It
 * tells a 0.7.7 database from an older one with the same migrations.
 */
export const MIN_VERSION_APP_STATE_KEY = 'storedDisplayUrlsCleared'

/** The part of a Drizzle SQLite database (sqlite-proxy or libsql) the check needs. */
type SqlRunner = {
  values: (query: SQL) => Promise<unknown[][]>
  run: (query: SQL) => Promise<unknown>
}

/** First column of the first row. libsql's rows index like arrays but aren't iterable. */
const firstValue = async (db: SqlRunner, query: SQL): Promise<unknown> => (await db.values(query))[0]?.[0]

const hasTable = async (db: SqlRunner, name: string): Promise<boolean> =>
  (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${name}`)).length > 0

/**
 * True if an SDK older than {@link MIN_UPGRADE_SDK_VERSION} wrote this database and no newer SDK
 * has opened it since. False for a new (empty) database.
 */
export async function isOlderThanMinimumUpgradeVersion(db: SqlRunner): Promise<boolean> {
  if (!(await hasTable(db, '__drizzle_migrations'))) return false
  const lastMigration = await firstValue(db, sql`SELECT MAX(created_at) FROM __drizzle_migrations`)
  if (lastMigration == null) return false
  if (Number(lastMigration) >= FIRST_MIGRATION_AFTER_MIN_VERSION_MILLIS) return false
  if (!(await hasTable(db, 'appState'))) return true
  const marker = await db.values(sql`SELECT 1 FROM appState WHERE key = ${MIN_VERSION_APP_STATE_KEY}`)
  return marker.length === 0
}

/**
 * Drops every table, view and trigger, so the migrations that follow build the database as on a
 * fresh install. `__drizzle_migrations` goes last: if this stops halfway, the next start still sees
 * an old database and drops the rest.
 */
async function dropAllObjects(db: SqlRunner): Promise<void> {
  const rows = await db.values(
    sql`SELECT type, name FROM sqlite_master
        WHERE type IN ('view', 'trigger', 'table') AND name NOT LIKE 'sqlite_%'`,
  )
  const order = { trigger: 0, view: 1, table: 2 } as Record<string, number>
  const objects = rows
    .map((row) => [String(row[0]), String(row[1])] as const)
    .sort(([typeA, nameA], [typeB, nameB]) =>
      order[typeA]! - order[typeB]! ||
      Number(nameA === '__drizzle_migrations') - Number(nameB === '__drizzle_migrations'))
  const foreignKeys = await firstValue(db, sql`PRAGMA foreign_keys`)
  // Dropping a parent table would otherwise run foreign key checks against tables not dropped yet.
  await db.run(sql`PRAGMA foreign_keys = OFF`)
  try {
    for (const [type, name] of objects) {
      await db.run(sql.raw(`DROP ${type.toUpperCase()} IF EXISTS "${name.replace(/"/g, '""')}"`))
    }
  } finally {
    if (Number(foreignKeys) === 1) await db.run(sql`PRAGMA foreign_keys = ON`)
  }
}

/**
 * Recreates a database an SDK older than {@link MIN_UPGRADE_SDK_VERSION} wrote (decision D1 of the
 * 2026-10 SDK audit): its tables are dropped before migrations run, so everything not yet published
 * is gone and published data comes back through EAS sync. Files under filesDir stay where they are.
 * Call it before migrations, holding the migrate lock. Returns true if it recreated the database.
 */
export async function recreateIfOlderThanMinimumUpgradeVersion(db: SqlRunner): Promise<boolean> {
  if (!(await isOlderThanMinimumUpgradeVersion(db))) return false
  console.warn(
    `[seed-protocol] This local database was written by an SDK older than ${MIN_UPGRADE_SDK_VERSION}. ` +
      'It is being recreated: unpublished items are dropped, and published items come back through EAS sync.',
  )
  await dropAllObjects(db)
  logger('dropped the tables of a database older than %s', MIN_UPGRADE_SDK_VERSION)
  return true
}
