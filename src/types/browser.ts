import { Endpoints } from './index'
import { SqliteRemoteResult } from 'drizzle-orm/sqlite-proxy'

export type SeedInitBrowserProps = {
  endpoints: Endpoints
}

export interface SeedInitBrowser {
  (props: SeedInitBrowserProps): Promise<void>
}

export type DbQueryResult = SqliteRemoteResult<SqliteWasmResult>

export type ResultObject = {
  [key: string]: string
}

export type SqliteWasmResult = {
  type: string | null
  row: string[] | null
  rowNumber: number | null
  columnNames: string[]
}

export type SqliteWasmCallback = (result: SqliteWasmResult) => void

export type ReturnObj = {
  database: string
  [key: string]: string | number | null | undefined | string[]
}
