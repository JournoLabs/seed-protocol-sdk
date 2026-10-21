import { BaseDb } from '@/db/Db/BaseDb'

export type Driver = (sql: string, params: unknown[], method: string) => Promise<unknown>

/**
 * Passes every statement through `wrap`: the app database's (sqlite-proxy `session.client`) and
 * each `BaseDb.transaction`'s, whose statements don't go through the app database's driver
 * (schema applies write their rows in one). Returns a function that undoes it.
 */
export function wrapDbDriver(wrap: (client: Driver) => Driver): () => void {
  const session = (BaseDb.getAppDb() as any).session as { client: Driver }
  const originalClient = session.client
  session.client = wrap(originalClient)
  const originalTransaction = BaseDb.transaction
  BaseDb.transaction = ((fn: (tx: any) => Promise<unknown>) =>
    originalTransaction.call(BaseDb, (tx: any) => {
      const txSession = tx?.session as { client?: Driver } | undefined
      if (txSession?.client) txSession.client = wrap(txSession.client)
      return fn(tx)
    })) as typeof BaseDb.transaction
  return () => {
    session.client = originalClient
    BaseDb.transaction = originalTransaction
  }
}
