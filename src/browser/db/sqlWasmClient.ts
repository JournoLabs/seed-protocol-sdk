import { SqliteConnectionManager } from '@/services/db'
import {
  SqliteRemoteDatabase,
  SqliteRemoteResult,
} from 'drizzle-orm/sqlite-proxy'
import { sql } from 'drizzle-orm'

let sqlite3InitModule: any
let sqliteWasmClient: any
let manager: SqliteConnectionManager | undefined
let isPreparing = false

export const setSqliteWasmClient = (client: any) => {
  sqliteWasmClient = client
}

export const getSqliteWasmClient = async () => {
  if (sqliteWasmClient) {
    return sqliteWasmClient
  }
  if (typeof window === 'undefined') {
    throw new Error('validateInput called from non-browser context')
  }

  if (isPreparing) {
    return
  }

  isPreparing = true

  if (!sqlite3InitModule) {
    sqlite3InitModule = await import('@sqlite.org/sqlite-wasm')
  }

  if (!window.sqlite3Worker1Promiser) {
    await sqlite3InitModule()
  }

  if (!window.sqlite3Worker1Promiser) {
    console.error('window.sqlite3Worker1Promiser not found')
    isPreparing = false
    return
  }

  try {
    sqliteWasmClient = await window.sqlite3Worker1Promiser.v2().catch((err) => {
      console.error('Error initializing sqliteWasmClient:', err)
      isPreparing = false
    })
  } catch (err) {
    console.error('Error initializing sqliteWasmClient:', err)
    isPreparing = false
  }
  return sqliteWasmClient
}

export const getManager = () => {
  return manager
}

export const setManager = (m: any) => {
  manager = m
}
let appDb: SqliteRemoteDatabase<Record<string, unknown>> | undefined
export const setAppDb = (db: SqliteRemoteDatabase<Record<string, unknown>>) => {
  appDb = db
}
export const getAppDb = () => {
  if (!appDb) {
    throw new Error('getAppDb: appDb is undefined')
  }

  return appDb
}
export const isAppDbReady = () => {
  return !!appDb
}
type RunQueryForStatement = (
  statement: string,
) => Promise<SqliteRemoteResult<unknown>>

export const runQueryForStatement: RunQueryForStatement = async (
  statement: string,
) => {
  const appDb = getAppDb()

  return appDb.run(sql.raw(statement))
}
