import { BaseDb } from "@/db/Db/BaseDb";
import { IDb } from "@/interfaces/IDb";
import debug from "debug";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle, SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate as drizzleMigrate } from "drizzle-orm/sqlite-proxy/migrator";
import { BROWSER_FS_TOP_DIR, DB_NAME_APP } from "@/services/internal/constants";
import { BaseFileManager } from "@/helpers";

const logger = debug('seedSdk:browser:db:Db')


class Db extends BaseDb implements IDb {

  static sqliteWasmClient: any
  static filesDir: string | undefined
  static pathToDb: string | undefined
  static dbId: string | undefined
  static appDb: SqliteRemoteDatabase<Record<string, unknown>> | undefined

  constructor() {
    super()
  }

  static getAppDb() {
    return this.appDb
  }

  static isAppDbReady() {
    return !!this.appDb
  }

  static async connectToDb(filesDir: string,): Promise<string | undefined> {

    if (Db.sqliteWasmClient) {
      return this.dbId
    }

    this.filesDir = filesDir

    if (typeof document === 'undefined') {
      return
    }

    let promiser

    try {

        let sqlite3Worker1Promiser

        const sqliteWasm = await import('@sqlite.org/sqlite-wasm')

        if (sqliteWasm && sqliteWasm.sqlite3Worker1Promiser) {
          sqlite3Worker1Promiser = sqliteWasm.sqlite3Worker1Promiser
        }

        if (!sqlite3Worker1Promiser && window.sqlite3Worker1Promiser) {
          sqlite3Worker1Promiser = window.sqlite3Worker1Promiser
        }

        if (!sqlite3Worker1Promiser) {
          throw new Error('Failed to load sqlite3Worker1Promiser')
        }

        promiser = await new Promise<(event: string, config: Record<string, unknown>) => Promise<any>>((resolve) => {
          const _promiser = sqlite3Worker1Promiser({
            onready: () => {
              resolve(_promiser);
            },
          });
        }).catch((error) => {
          console.error('Error from sqlite proxy server: ', JSON.stringify(error))
        });

    } catch ( e ) {
      console.error('Error from sqlite proxy server: ', JSON.stringify(e))
    }


    if (!promiser) {
      throw new Error('Failed to create promiser')
    }

    this.sqliteWasmClient = promiser

    const responseGet = await this.sqliteWasmClient('config-get', {});

    logger('[Db.prepareDb] Running SQLite3 version', responseGet.result.version.libVersion);

    const responseOpen = await this.sqliteWasmClient('open', {
      filename: `file:${filesDir}/db/${DB_NAME_APP}.sqlite3?vfs=opfs`,
    });
    const { dbId } = responseOpen;
    logger(
      '[Db.prepareDb] OPFS is available, created persisted database at',
      responseOpen.result.filename.replace(/^file:(.*?)\?vfs=opfs/, '$1'),
    );

    logger('[Db.prepareDb] dbId', dbId)  

    this.dbId = dbId

    return dbId
  }

  static async migrate(pathToDbDir: string, dbName: string,): Promise<void> {

    const schemaGlobString = `${BROWSER_FS_TOP_DIR}/schema/*`

    const drizzleDb = drizzle(
      async (sql, params, method) => {
        try {
          // logger(
          //   `executing sql on ${dbName} with id: ${dbId} and method: ${method}`,
          //   sql,
          // )

          const finalResult = await this.exec(sql, params)

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
      const zenfs = await BaseFileManager.getFs()

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
            await zenfs.promises.unlink(`${pathToDbDir}/${dbName}.sqlite3`)
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

      await BaseFileManager.waitForFile(`${pathToDbDir}/meta/_journal.json`)

      const journalExists = await BaseFileManager.pathExists(
        `${pathToDbDir}/meta/_journal.json`,
      )

      if (journalExists) {
        await this.migrate(pathToDbDir, dbName,)
      }

      if (!journalExists) {
        throw new Error('Failed to migrate database')
      }


    }

    this.appDb = drizzleDb
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

  static async exec(sql: string, params: any[]) {
    const rowsToReturnRaw: SqliteWasmResult[] = []
    const rowsValues: string[][] = []
  
    // For a single exec command, the callback potentially gets called several times -- once for each row.
    // So we need to collect all rows into a final array to return (execResult).
    const rowsToReturn = await new Promise((resolve, reject) => {


     this.sqliteWasmClient('exec', {
        dbId:this.dbId,
        sql,
        bind: params,
        callback: (result) => {
          // Checks if this is the final callback of the query
          if (!result || !result.row || !result.rowNumber) {
            const returnResult = []
            for (const currRow of rowsToReturnRaw) {
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
  
    return rowsToReturn || []
  }
}

export { Db }
