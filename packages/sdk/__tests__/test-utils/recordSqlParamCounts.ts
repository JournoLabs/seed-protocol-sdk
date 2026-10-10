import { vi } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'

export type RecordedStatement = { sql: string; paramCount: number }

/**
 * Runs `fn` and returns the SQL text and number of bound parameters of every statement sent to the
 * Node (libsql) client. libsql allows 32766 parameters per statement and long statements, so a
 * statement over SQLite's old defaults doesn't fail there; tests use this to check directly.
 * NodeJS only.
 */
export async function recordSqlStatements(fn: () => Promise<unknown>): Promise<RecordedStatement[]> {
  const client = BaseDb.getAppDb().$client
  const statements: RecordedStatement[] = []
  const record = (stmt: any) => {
    const sql = typeof stmt === 'string' ? stmt : String(stmt?.sql ?? '')
    const args = typeof stmt === 'string' ? [] : (stmt?.args ?? [])
    statements.push({ sql, paramCount: Array.isArray(args) ? args.length : Object.keys(args).length })
  }
  const originalExecute = client.execute.bind(client)
  const originalBatch = client.batch.bind(client)
  const execute = vi.spyOn(client, 'execute').mockImplementation((async (stmt: any, ...rest: any[]) => {
    record(stmt)
    return originalExecute(stmt, ...rest)
  }) as any)
  const batch = vi.spyOn(client, 'batch').mockImplementation((async (stmts: any[], ...rest: any[]) => {
    for (const s of stmts) record(s)
    return originalBatch(stmts, ...rest)
  }) as any)
  try {
    await fn()
  } finally {
    execute.mockRestore()
    batch.mockRestore()
  }
  return statements
}

/** {@link recordSqlStatements}, keeping only each statement's bound-parameter count. */
export async function recordSqlParamCounts(fn: () => Promise<unknown>): Promise<number[]> {
  return (await recordSqlStatements(fn)).map((s) => s.paramCount)
}
