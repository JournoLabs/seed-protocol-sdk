import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { withSqliteBusyRetry } from '@/browser/db/sqliteBusyRetry'

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

  client.execute = withSqliteBusyRetry(async (...args: Parameters<Client['execute']>) => {
    await outsideTransactions()
    return execute(...args)
  }) as Client['execute']
  client.batch = withSqliteBusyRetry(async (...args: Parameters<Client['batch']>) => {
    await outsideTransactions()
    return batch(...args)
  }) as Client['batch']

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
      await execute('BEGIN IMMEDIATE')
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
