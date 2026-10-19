import type { IDb } from '@/interfaces/IDb'
import { Observable } from 'rxjs'
import { isSqliteBusyError, SQLITE_BUSY_RETRY_DELAYS_MS } from '@/browser/db/sqliteBusyRetry'

export abstract class BaseDb {
  static filesDir: string | undefined
  private static _impl: IDb | null = null

  static configure(impl: IDb): void {
    if (!impl) {
      throw new Error(
        'Cannot configure Db with undefined or null. Ensure the platform-specific Db is properly created.',
      )
    }
    BaseDb._impl = impl
  }

  private static requireImpl(): IDb {
    if (!BaseDb._impl) {
      throw new Error(
        'Db not configured. Call BaseDb.configure() during platform init.',
      )
    }
    return BaseDb._impl
  }

  static getAppDb(): any {
    return BaseDb.requireImpl().getAppDb()
  }

  static prepareDb(filesDir: string, config?: any): Promise<any> {
    return BaseDb.requireImpl().prepareDb(filesDir, config)
  }

  static isAppDbReady(): boolean {
    if (!BaseDb._impl) {
      return false
    }
    return BaseDb._impl.isAppDbReady()
  }

  static connectToDb(pathToDir: string): Promise<unknown> {
    return BaseDb.requireImpl().connectToDb(pathToDir)
  }

  static async migrate(pathToDbDir: string, dbName: string, dbId: string): Promise<void> {
    return BaseDb.requireImpl().migrate(pathToDbDir, dbName, dbId)
  }

  /**
   * Execute a reactive query that emits new results whenever the underlying data changes.
   *
   * Supports two usage patterns:
   * 1. SQL tag function (browser only): liveQuery((sql) => sql`SELECT * FROM models`)
   * 2. Drizzle query builder: liveQuery(db.select().from(models))
   *
   * On Node only the query builder works (a tag function throws), and it is re-run every second;
   * the observable emits when the result changes.
   */
  static liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]> {
    return BaseDb.requireImpl().liveQuery<T>(query)
  }

  /**
   * Runs `fn` in one transaction: every query it runs on `tx` (a Drizzle database, used like
   * `getAppDb()`) commits together, or none does when `fn` throws. Queries on `getAppDb()` inside
   * `fn` are not part of the transaction, and in the browser they wait for it to end, so don't
   * call `getAppDb()` or `BaseDb.transaction` from `fn`.
   *
   * When another connection (another tab) holds the database lock, the whole transaction is
   * retried, so `fn` must have no side effects outside `tx`.
   */
  static async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const impl = BaseDb.requireImpl()
    for (let attempt = 0; ; attempt++) {
      try {
        return await impl.transaction(fn)
      } catch (error) {
        if (!isSqliteBusyError(error) || attempt >= SQLITE_BUSY_RETRY_DELAYS_MS.length) throw error
        await new Promise((resolve) => setTimeout(resolve, SQLITE_BUSY_RETRY_DELAYS_MS[attempt]))
      }
    }
  }
}
