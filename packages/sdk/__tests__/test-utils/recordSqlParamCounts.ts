import { vi } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'

/**
 * Runs `fn` and returns the number of bound parameters of every statement sent to the Node
 * (libsql) client. libsql allows 32766 parameters per statement, so a statement over SQLite's old
 * default of 999 doesn't fail there; tests use this to check the count directly. NodeJS only.
 */
export async function recordSqlParamCounts(fn: () => Promise<unknown>): Promise<number[]> {
  const client = BaseDb.getAppDb().$client
  const counts: number[] = []
  const countArgs = (stmt: any) => {
    const args = typeof stmt === 'string' ? [] : (stmt?.args ?? [])
    counts.push(Array.isArray(args) ? args.length : Object.keys(args).length)
  }
  const originalExecute = client.execute.bind(client)
  const originalBatch = client.batch.bind(client)
  const execute = vi.spyOn(client, 'execute').mockImplementation((async (stmt: any, ...rest: any[]) => {
    countArgs(stmt)
    return originalExecute(stmt, ...rest)
  }) as any)
  const batch = vi.spyOn(client, 'batch').mockImplementation((async (stmts: any[], ...rest: any[]) => {
    for (const s of stmts) countArgs(s)
    return originalBatch(stmts, ...rest)
  }) as any)
  try {
    await fn()
  } finally {
    execute.mockRestore()
    batch.mockRestore()
  }
  return counts
}
