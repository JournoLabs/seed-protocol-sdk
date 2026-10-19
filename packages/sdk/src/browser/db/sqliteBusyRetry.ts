import debug from 'debug'

const logger = debug('seedSdk:browser:db:sqliteBusyRetry')

/** Waits between attempts; about 1 s in total. */
export const SQLITE_BUSY_RETRY_DELAYS_MS = [25, 75, 150, 300, 450]

/**
 * Another connection (usually another tab) holds the database lock. SQLite reports this as
 * SQLITE_BUSY ("database is locked") or SQLITE_LOCKED ("database table is locked").
 */
export function isSqliteBusyError(error: unknown): boolean {
  // Drizzle wraps a driver's error ("Failed query: ...") and keeps it as `cause`
  for (let current: unknown = error, depth = 0; current != null && depth < 5; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (/SQLITE_BUSY|SQLITE_LOCKED|database (table )?is locked/i.test(message)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Retries a statement another tab's lock rejected. Safe for the SDK's writes because each is a
 * single autocommit statement: one that failed with SQLITE_BUSY didn't apply. Don't use this for
 * statements inside a transaction, where a retry would replay part of it.
 */
export function withSqliteBusyRetry<Args extends unknown[], R>(
  driver: (...args: Args) => Promise<R>,
  delaysMs: number[] = SQLITE_BUSY_RETRY_DELAYS_MS,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await driver(...args)
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt >= delaysMs.length) throw error
        logger(`database busy (attempt ${attempt + 1}); retrying`)
        await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
      }
    }
  }
}
