import type { Observable } from 'rxjs'

/**
 * Platform database implementation contract.
 * Static facade BaseDb delegates here after configure().
 */
export interface IDb {
  getAppDb(): any
  prepareDb(filesDir: string, config?: any): Promise<any>
  isAppDbReady(): boolean
  connectToDb(pathToDir: string): Promise<unknown>
  migrate(pathToDbDir: string, dbName: string, dbId: string): Promise<void>
  liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]>
  /** Runs `fn` in one transaction; `fn` must run its queries on the `tx` it is given. */
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>
  /**
   * Closes the database (the browser's SQLocal worker, Node's libsql client), so its file is
   * released, and forgets it: `getAppDb()` is undefined until the next `prepareDb`. A `prepareDb`
   * still running finishes by closing what it opened. Safe to call when nothing is open.
   */
  close(): Promise<void>
}
