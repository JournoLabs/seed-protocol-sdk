// // import { SqliteConnectionManager } from '@/services/db/connectionManager'
// import {
//   SqliteRemoteDatabase,
//   SqliteRemoteResult,
// } from 'drizzle-orm/sqlite-proxy'
// import { sql } from 'drizzle-orm'
// import debug from 'debug'
// import { sqlite3Worker1Promiser } from '@sqlite.org/sqlite-wasm'
// import { DB_NAME_APP } from '@/services/internal/constants'

// const logger = debug('seedSdk:browser:db:sqlWasmClient')

// let sqliteWasmClient: any
// let appDb: SqliteRemoteDatabase<Record<string, unknown>> | undefined

// let dbId: string | undefined
// let filesDir: string | undefined
// let pathToDb: string | undefined

// // export const setSqliteWasmClient = (client: any) => {
// //   sqliteWasmClient = client
// // }

// export const initSqliteWasmClient = async (filesDirExternal: string) => {
//   if (sqliteWasmClient) {
//     return dbId
//   }

//   filesDir = filesDirExternal

//   const promiser = await new Promise<(event: string, config: Record<string, unknown>) => Promise<any>>((resolve) => {
//     const _promiser = sqlite3Worker1Promiser({
//       onready: () => {
//         resolve(_promiser);
//       },
//     });
//   });

//   if (!promiser) {
//     throw new Error('Failed to create promiser')
//   }

//   sqliteWasmClient = promiser

//   const responseGet = await sqliteWasmClient('config-get', {});

//   logger('[Db.prepareDb] Running SQLite3 version', responseGet.result.version.libVersion);

//   const responseOpen = await sqliteWasmClient('open', {
//     filename: `file:${filesDir}/db/${DB_NAME_APP}.sqlite3?vfs=opfs`,
//   });
//   const { dbId: dbIdFromOpen } = responseOpen;
//   logger(
//     '[Db.prepareDb] OPFS is available, created persisted database at',
//     responseOpen.result.filename.replace(/^file:(.*?)\?vfs=opfs/, '$1'),
//   );

//   logger('[Db.prepareDb] dbId', dbId)  

//   dbId = dbIdFromOpen

//   return dbId
// }

// export const getSqliteWasmClient = () => {
//   return sqliteWasmClient
// }

// export const setAppDb = (db: SqliteRemoteDatabase<Record<string, unknown>>) => {
//   appDb = db
// }
// export const getAppDb = () => {
//   if (!appDb) {
//     throw new Error('getAppDb: appDb is undefined')
//   }

//   return appDb
// }
// export const isAppDbReady = () => {
//   return !!appDb
// }
// type RunQueryForStatement = (
//   statement: string,
// ) => Promise<SqliteRemoteResult<unknown>>

// export const runQueryForStatement: RunQueryForStatement = async (
//   statement: string,
// ) => {
//   const appDb = getAppDb()

//   return appDb.run(sql.raw(statement))
// }
