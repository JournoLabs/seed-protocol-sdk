import { BaseDb } from "@/db/Db/BaseDb";
import { IDb } from "@/interfaces/IDb";
import { getAppDb, getSqliteWasmClient, isAppDbReady, setAppDb } from "./sqlWasmClient";
import { SqliteConnectionManager } from "@/services/db";
import debug from "debug";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate as drizzleMigrate } from "drizzle-orm/sqlite-proxy/migrator";
import { BROWSER_FS_TOP_DIR } from "@/services/internal/constants";
import { FileManager } from "@/browser/helpers/FileManager";
const logger = debug('app:browser:db:Db')

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

class Db extends BaseDb implements IDb {
  constructor() {
    super()
  }

  static getAppDb() {
    return getAppDb()
  }

  static isAppDbReady() {
    return isAppDbReady()
  }

  static prepareDb(filesDir: string) {

    return new Promise((resolve, reject) => {
      let sqliteWasmClient
      const interval = setInterval(() => {
        // TODO: Add a timeout
        // TODO: Add a cancel token to the promise so we can prevent more loops starting while we're checking the successful outcome
        getSqliteWasmClient().then((sqliteWasmClient) => {
          if (sqliteWasmClient) {
            clearInterval(interval)
            const manager = new SqliteConnectionManager(sqliteWasmClient)
            resolve(manager)
          }
        })

      }, 200)
    })
  }

  static async connectToDb(pathToDir: string, dbName: string): Promise<string> {

    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {

        // TODO: Add a timeout
        // TODO: Add a cancel token to the promise so we can prevent more loops starting while we're checking the successful outcome
        getSqliteWasmClient().then((sqliteWasmClient) => {

          if (!sqliteWasmClient) {
            return
          }

          //@ts-ignore
          sqliteWasmClient('config-get', {}).then((response) => {
            logger(response)
            logger('Running SQLite3 version', response.result.version.libVersion)

            //@ts-ignore
            sqliteWasmClient('open', {
              filename: `file:${pathToDir}/db/${dbName}.sqlite3?vfs=opfs`,
            }).then((response: { dbId: string, result: { filename: string } }) => {

              logger(response)
              const dbId = response.dbId
              logger(
                'OPFS is available, created persisted database at',
                response.result.filename.replace(/^file:(.*?)\?vfs=opfs$/, '$1'),
              )

              if (dbId) {
                clearInterval(interval)
                resolve(dbId)
              }
            })
          })
        })
      }, 500)
    })
  }

  static async migrate(pathToDbDir: string, dbName: string, dbId: string): Promise<void> {

    const fs = await import('@zenfs/core')

    const schemaGlobString = `${BROWSER_FS_TOP_DIR}/schema/*`

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

      const filesInRoot = await fs.promises.readdir('/')
      logger('filesInRoot', filesInRoot)
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

          const queryMigrationsTable = await drizzleDb.run(
            sql.raw(
              `SELECT name 
               FROM sqlite_master 
               WHERE type='table' 
               AND name='__drizzle_migrations';`,
            ),
          )

          logger('queryMigrationsTable', queryMigrationsTable)

          if (queryMigrationsTable && queryMigrationsTable.rows && queryMigrationsTable.rows.length > 0) {
            const query = await drizzleDb.run(
              sql.raw(
                `SELECT hash, created_at
                 FROM main.__drizzle_migrations;`,
              ),
            )
  
            rows = query.rows
          }

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

      await FileManager.waitForFile(`${pathToDbDir}/meta/_journal.json`)

      await this.migrate(pathToDbDir, dbName)

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
}

BaseDb.setPlatformClass(Db)

export { Db }