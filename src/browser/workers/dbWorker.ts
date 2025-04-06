// import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// export default `(
//   ${
//     function () {

// let sqliteWasmClient: any
// let pathToDbDir: string | undefined
// let dbName: string | undefined

// const dbExec = async (dbId: string, params: any[], sql: string, dbName: string, retries = 2) => {
//   const rowsToReturnRaw: SqliteWasmResult[] = []
//   const rowsValues: string[][] = []

//   // For a single exec command, the callback potentially gets called several times -- once for each row.
//   // So we need to collect all rows into a final array to return (execResult).
//   const rowsToReturn = await new Promise((resolve, reject) => {
//     sqliteWasmClient('exec', {
//       dbId,
//       sql,
//       bind: params,
//       callback: (result) => {
//         // Checks if this is the final callback of the query
//         if (!result || !result.row || !result.rowNumber) {
//           const returnResult = []
//           for (const currRow of rowsToReturnRaw) {
//             returnResult.push(currRow.row)
//           }
//           resolve(returnResult)
//         } else {
//           // If not the final response, add this row to the return array
//           rowsToReturnRaw.push(result)
//         }
//       },
//     }).catch(async (error) => {
//       reject(error)
//     })
//   })

//   return rowsToReturn || []
// }

// const start = (sqlite3: any) => {
//   console.log('Running SQLite3 version', sqlite3.version.libVersion);
//   sqliteWasmClient =
//     'opfs' in sqlite3
//       ? new sqlite3.oo1.OpfsDb(`${pathToDbDir}/db/${dbName}.sqlite3`)
//       : new sqlite3.oo1.DB('/mydb.sqlite3', 'ct');
//   console.log(
//     'opfs' in sqlite3
//       ? `OPFS is available, created persisted database at ${sqliteWasmClient.filename}`
//       : `OPFS is not available, created transient database ${sqliteWasmClient.filename}`,
//   );
//   // Your SQLite code here.
//   globalThis.postMessage({
//     done: true,
//     dbId: sqliteWasmClient.dbId,
//   })
// };

// const initializeSQLite = async () => {
//   try {
//     console.log('Loading and initializing SQLite3 module...');
//     const sqlite3 = await window.sqlite3InitModule({ print: console.log, printErr: console.log });
//     console.log('Done initializing. Connecting to DB...');
//     start(sqlite3);
//   } catch (err) {
//     console.log('Initialization error:', err.name, err.message);
//   }
// };

// // const setupconsole.log = async () => {
// //   const debug = await import('debug')
// //   console.log = debug('seedSdk:browser:workers:dbClientWorker')
// // }

// onmessage = async (e) => {
//   console.log('[dbWorker] onmessage', e.data)
//   console.log('globalThis', globalThis)
//   if (!globalThis.sqlite3InitModule) {
//     console.log('window.sqlite3InitModule not found')
//     return
//   }
//   console.log('window.sqlite3InitModule', globalThis.sqlite3InitModule)
//   // await setupconsole.log()
//   pathToDbDir = e.data.pathToDbDir
//   dbName = e.data.dbName
//   await initializeSQLite()
//   console.log(`[dbWorker] Done`)
// }
// }.toString()
// }
// )()`


