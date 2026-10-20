import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { isSqliteBusyError, SQLITE_BUSY_RETRY_DELAYS_MS } from '@/browser/db/sqliteBusyRetry'

/**
 * Transactions on libsql's one connection, with the browser's semantics (ADR 0019).
 *
 * libsql's own `transaction()` hands the transaction the client's connection and opens a new one
 * for everything after, so a process ends up with several connections that lock each other out
 * (SQLITE_BUSY) and, in tests, lost an outbox op's committed insert. Here every statement uses the
 * client's single connection instead:
 *
 * - `transaction(fn)` runs one transaction at a time: BEGIN IMMEDIATE, `fn` on a Drizzle database
 *   whose statements go straight to the connection, then COMMIT, or ROLLBACK when `fn` throws.
 * - Statements on the app database (the patched client) wait while a transaction is open, as
 *   SQLocal makes them wait in the browser. So `fn` must not use the app database: it would wait
 *   for its own transaction.
 * - Statements outside a transaction keep the busy retry: another process may hold the file.
 *
 * libsql 0.5 doesn't reset a statement that failed with SQLITE_BUSY, and that leaves its
 * connection in an implicit transaction that never commits: every later write on it is lost when it
 * closes and never reaches the file (`inTransaction` still reads false). So after a busy error the
 * connection is replaced (`reconnect()`) before anything else runs on it, and a transaction waits
 * for statements that are between attempts.
 */
export function createSingleConnectionTransactions(client: Client, schema: Record<string, unknown>) {
  const execute = client.execute.bind(client)
  const batch = client.batch.bind(client)

  /** Resolves when the open transaction ends; undefined when none is open. */
  let open: Promise<void> | undefined
  /** The transactions waiting their turn, chained. */
  let queue: Promise<void> = Promise.resolve()

  const outsideTransactions = async () => {
    while (open) await open
  }

  /** Statements outside transactions that are running or replacing a busy connection. */
  let statementsRunning = 0
  const whenStatementsDone: (() => void)[] = []
  const statementsDone = () =>
    statementsRunning === 0 ? Promise.resolve() : new Promise<void>((resolve) => whenStatementsDone.push(resolve))

  const statement = async <T>(run: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      await outsideTransactions()
      statementsRunning++
      try {
        return await run()
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt >= SQLITE_BUSY_RETRY_DELAYS_MS.length) throw error
        await client.reconnect()
      } finally {
        if (--statementsRunning === 0) for (const resolve of whenStatementsDone.splice(0)) resolve()
      }
      await new Promise((resolve) => setTimeout(resolve, SQLITE_BUSY_RETRY_DELAYS_MS[attempt]))
    }
  }

  client.execute = ((...args: Parameters<Client['execute']>) => statement(() => execute(...args))) as Client['execute']
  client.batch = ((...args: Parameters<Client['batch']>) => statement(() => batch(...args))) as Client['batch']

  // What Drizzle uses of the client, straight to the connection: the transaction's own statements
  const transactionClient = {
    execute,
    batch,
    protocol: client.protocol,
    get closed() {
      return client.closed
    },
  } as unknown as Client
  const transactionDb = drizzle(transactionClient, { schema })

  async function transaction<T>(fn: (tx: typeof transactionDb) => Promise<T>): Promise<T> {
    const previous = queue
    let finished!: () => void
    queue = new Promise<void>((resolve) => (finished = resolve))
    await previous
    let end!: () => void
    open = new Promise<void>((resolve) => (end = resolve))
    try {
      await statementsDone()
      try {
        await execute('BEGIN IMMEDIATE')
      } catch (error) {
        // Busy: BaseDb.transaction retries the whole transaction, on a fresh connection
        if (isSqliteBusyError(error)) await client.reconnect()
        throw error
      }
      try {
        const result = await fn(transactionDb)
        await execute('COMMIT')
        return result
      } catch (error) {
        try {
          await execute('ROLLBACK')
        } catch {
          // Already rolled back (SQLite does on some errors)
        }
        if (isSqliteBusyError(error)) await client.reconnect()
        throw error
      }
    } finally {
      open = undefined
      end()
      finished()
    }
  }

  return { transaction }
}
