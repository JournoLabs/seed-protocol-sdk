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
}
