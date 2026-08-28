import type { IDb } from '@/interfaces/IDb'
import { Observable } from 'rxjs'

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
   * 1. SQL tag function: liveQuery((sql) => sql`SELECT * FROM models`)
   * 2. Drizzle query builder (browser only): liveQuery(db.select().from(models))
   */
  static liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]> {
    return BaseDb.requireImpl().liveQuery<T>(query)
  }
}
