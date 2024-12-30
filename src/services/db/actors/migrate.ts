import { EventObject, fromCallback } from 'xstate'
import { DbServiceContext, FromCallbackInput, SqliteWasmResult } from '@/types'
import {
  BROWSER_FS_TOP_DIR,
  DB_MIGRATING_SUCCESS,
} from '@/services/internal/constants'
import { getSqliteWasmClient, setAppDb } from '@/browser/db/sqlWasmClient'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { sql } from 'drizzle-orm'
import { fs } from '@zenfs/core'
import debug from 'debug'
import { migrate as drizzleMigrate } from 'drizzle-orm/sqlite-proxy/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import * as fsNode from 'node:fs'
import { waitForFile } from '@/helpers/files'

const logger = debug('app:services:db:actors:migrate')

export const dbExec = async (dbId, params, sql, dbName, retries = 2) => {
  const rowsToReturnRaw: SqliteWasmResult[] = []
  const rowsValues: string[][] = []

  const sqliteWasmClient = await getSqliteWasmClient()

  // For a single exec command, the callback potentially gets called several times -- once for each row.
  // So we need to collect all rows into a final array to return (execResult).
  const rowsToReturn = await new Promise((resolve, reject) => {
    sqliteWasmClient('exec', {
      dbId,
      sql,
      bind: params,
      callback: (result) => {
        // Checks if this is the final callback of the query
        if (!result || !result.row || !result.rowNumber) {
          const returnResult = []
          // Before returning the array, we process it to match the expected output format
          // const rowsToReturnProcessed = rowsToReturnRaw.reduce((acc, curr) => {
          //   if (
          //     Array.isArray(curr.row) &&
          //     curr.row?.length > 0 &&
          //     curr.columnNames.length > 0
          //   ) {
          //     const returnObj: ReturnObj = {
          //       database: dbName,
          //     }
          //
          //     const values = []
          //
          //     curr.columnNames.forEach((colName, index: number) => {
          //       if (curr.row && curr.row[index]) {
          //         returnObj[colName] = curr.row[index]
          //         values.push(curr.row[index])
          //       }
          //     })
          //     // rowsValueStrings.push(`(${values.join(', ')})`)
          //     acc.push(returnObj)
          //   }
          //   return acc
          // }, [] as string[])
          for (const currRow of rowsToReturnRaw) {
            // const values: string[] = []
            // currRow.columnNames.forEach((colName, index: number) => {
            //   if (currRow.row) {
            //     values.push(currRow.row[index])
            //   }
            // })
            // logger(`[db/actors] [dbExec] currRow`, currRow)
            returnResult.push(currRow.row)
          }
          resolve(returnResult)
        } else {
          // If not the final response, add this row to the return array
          rowsToReturnRaw.push(result)
        }
      },
    }).catch(async (error) => {
      reject(error)
    })
  })

  // logger(`[db/actors] [dbExec] rowsToReturn`, rowsToReturn)
  // logger(`[db/actors] [dbExec] rowsValues`, rowsValues)

  return rowsToReturn || []
}

export const migrate = fromCallback<
  EventObject,
  FromCallbackInput<DbServiceContext>
>(({ sendBack, input: { context } }) => {
  const { pathToDbDir, dbId, dbName } = context

  logger('[db/actors] migrate context', context)

  const schemaGlobString = `${BROWSER_FS_TOP_DIR}/schema/*`

  let journalExists = false

  // const _initFs = async (): Promise<void> => {
  //   const handle = await navigator.storage.getDirectory()
  //   // await configure({ backend: WebAccess, handle })
  //   await configureSingle({
  //     backend: WebAccess,
  //     handle,
  //   })
  // }
  //
  // _initFs()

  const _checkForFiles = async (): Promise<void> => {
    const journalPath = `/${pathToDbDir}/meta/_journal.json`

    journalExists = await fs.promises.exists(journalPath)

    const journalExistsAsync = journalExists

    const journalExistsSync = fs.existsSync(journalPath)

    const journalExistsSyncNode = fsNode.existsSync(journalPath)

    console.log('journalExistsAsync', journalExistsAsync)
    console.log('journalExistsSync', journalExistsSync)
    console.log('journalExistsSyncNode', journalExistsSyncNode)

    if (!journalExists) {
      await waitForFile(journalPath)
      // const handle = await navigator.storage.getDirectory()
      //
      // await configureSingle({
      //   backend: WebAccess,
      //   handle,
      // })

      // window.location.reload()

      // setTimeout(() => {
      //   _checkForFiles().then(() => {
      //     return
      //   })
      // }, 500)
    }
  }

  const _migrate = async (): Promise<void> => {
    const drizzleDb = drizzle(
      async (sql, params, method) => {
        try {
          // logger(
          //   `executing sql on ${dbName} with id: ${dbId} and method: ${method}`,
          //   sql,
          // )

          const finalResult = await dbExec(dbId, params, sql, dbName)

          // logger(`finalResult with method: ${method}`, finalResult)
          // Drizzle always waits for {rows: string[][]} or {rows: string[]} for the return value.

          // When the method is get,  you should return a value as {rows: string[]}.
          // Otherwise, you should return {rows: string[][]}.

          return { rows: finalResult }
        } catch (e: any) {
          console.error('Error from sqlite proxy server: ', JSON.stringify(e))
          return { rows: [] }
        }
      },
      {
        schema: schemaGlobString,
        // logger: true,
      },
    )

    try {
      const migrations = readMigrationFiles({
        migrationsFolder: pathToDbDir,
      })

      if (migrations.length > 0) {
        const incomingMigrationHashes = migrations.map(
          (migration) => migration.hash,
        )

        let existingMigrationHashes
        let rows = []

        try {
          const query = await drizzleDb.run(
            sql.raw(
              `SELECT hash, created_at
               FROM main.__drizzle_migrations;`,
            ),
          )

          rows = query.rows
        } catch (e) {
          rows = []
        }

        if (rows && rows.length > 0) {
          existingMigrationHashes = rows.map((row) => row[0])
        }

        if (existingMigrationHashes) {
          let shouldRebuildDb = false
          for (const existingHash of existingMigrationHashes) {
            if (!incomingMigrationHashes.includes(existingHash)) {
              shouldRebuildDb = true
              break
            }
          }
          if (shouldRebuildDb) {
            await fs.promises.unlink(`${pathToDbDir}/${dbName}.sqlite3`)
          }
        }
      }

      await drizzleMigrate(
        drizzleDb,
        async (queriesToRun) => {
          // logger('queriesToRun', queriesToRun)
          for (const query of queriesToRun) {
            // logger('query', query)
            await drizzleDb.run(sql.raw(query))
          }
        },
        {
          migrationsFolder: pathToDbDir,
        },
      )
    } catch (error) {
      // console.error('Error migrating database: ', error)
      // window.location.reload()
      // const handle = await navigator.storage.getDirectory()
      //
      // await configureSingle({
      //   backend: WebAccess,
      //   handle,
      // })

      await waitForFile(`${pathToDbDir}/meta/_journal.json`)

      return _migrate()
    }

    setAppDb(drizzleDb)
    // const createTempTableQuery = await appDb.run(
    //   sql.raw(
    //     `CREATE TEMP TABLE IF NOT EXISTS temp_last_inserted_id (id INTEGER, table TEXT);`,
    //   ),
    // )
    //
    // logger(
    //   '[db/actors] [migrate] createTempTableQuery',
    //   createTempTableQuery,
    // )

    // const triggersQuery = await appDb.run(
    //   sql.raw(
    //     `SELECT name
    //      FROM main.sqlite_master
    //      WHERE type = 'trigger';`,
    //   ),
    // )
    //
    // logger('[db/actors] [migrate] triggersQuery', triggersQuery)
    //
    // const triggers = triggersQuery.rows.map((row) => row[0])
    //
    // const tablesQuery = await appDb.run(
    //   sql.raw(
    //     `SELECT name
    //      FROM main.sqlite_master
    //      WHERE type = 'table';`,
    //   ),
    // )
    //
    // logger('[db/actors] [migrate] tablesQuery', tablesQuery)
    //
    // const tableNames = tablesQuery.rows.map((row) => row[0])
    // logger('[db/actors] [migrate] tableNames', tableNames)
    // for (const tableName of tableNames) {
    //   const triggerName = `after_insert_${tableName}`
    //   if (triggers.includes(triggerName)) {
    //     continue
    //   }
    //           const createTriggerQuery = await appDb.run(
    //             sql.raw(
    //               `CREATE TRIGGER after_insert_${tableName}
    // AFTER INSERT ON ${tableName}
    // BEGIN
    //     DELETE FROM temp_last_inserted_id;
    //     INSERT INTO temp_last_inserted_id (id) VALUES (new.id);
    // END;`,
    //             ),
    //           )
    //
    //           logger(
    //             '[db/actors] [migrate] createTriggerQuery',
    //             createTriggerQuery,
    //           )
    //         }
  }

  _checkForFiles()
    .then(() => {
      if (journalExists) {
        return _migrate()
      }
    })
    .then(() => {
      sendBack({ type: DB_MIGRATING_SUCCESS, dbName })
    })

  return () => { }
})
