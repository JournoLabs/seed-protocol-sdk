import { BaseDb } from "@/db/Db/BaseDb";
import { IDb } from "@/interfaces/IDb";
import debug from "debug";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle, SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate as drizzleMigrate } from "drizzle-orm/sqlite-proxy/migrator";
import { BROWSER_FS_TOP_DIR } from "@/client/constants";
import { BaseFileManager } from "@/helpers";
import * as schema from '@/seedSchema'
// @ts-ignore - sqlocal/drizzle types may not be available during build
import { SQLocalDrizzle } from 'sqlocal/drizzle'
import {} from 'sqlocal'
import * as drizzleFiles from './drizzleFiles'
import { journalJson, snapshotJson } from './drizzleFiles'
import { Observable, distinctUntilChanged } from 'rxjs'

const logger = debug('seedSdk:browser:db:Db')


class Db extends BaseDb implements IDb {

  static sqliteWasmClient: any
  static filesDir: string | undefined
  static pathToDb: string | undefined
  static dbId: string | undefined
  static appDb: SqliteRemoteDatabase<Record<string, unknown>> | undefined
  static sqlocalInstance: SQLocalDrizzle | undefined

  constructor() {
    super()
  }

  static getAppDb() {
    return this.appDb
  }

  static isAppDbReady() {
    return !!this.appDb
  }

  static async prepareDb(filesDir: string) {

    logger('[Db.prepareDb] preparing database')

    this.filesDir = filesDir

    try {
      // Copy drizzle migration files from src/db/drizzle to filesDir/db
      await this.copyDrizzleFiles(filesDir)

      // Ensure meta directory exists
      const metaDirPath = `${filesDir}/db/meta`
      await BaseFileManager.createDirIfNotExists(metaDirPath)

      // Ensure _journal.json file exists in meta directory
      const journalFilePath = `${metaDirPath}/_journal.json`
      const journalExists = await BaseFileManager.pathExists(journalFilePath)
      if (!journalExists) {
        await BaseFileManager.saveFile(journalFilePath, JSON.stringify({
          version: 1,
          dialect: 'sqlite',
          entries: [],
        }, null, 2))
      }

      // Wait for journal file to be fully written before proceeding with migration
      // This is critical in browser/OPFS where writes may not be immediately readable
      logger('[Db.prepareDb] waiting for journal file to be fully written...')
      await BaseFileManager.waitForFileWithContent(journalFilePath, 100, 5000)
      logger('[Db.prepareDb] journal file is ready')

      // Initialize SQLocalDrizzle with reactive: true to enable reactive queries
      const sqlocalDrizzle = new SQLocalDrizzle({
        databasePath: `${this.filesDir}/db/seed.db`,
        reactive: true  // Enable reactive queries
      })
      
      const { driver, batchDriver } = sqlocalDrizzle
      
      // Store SQLocalDrizzle instance for reactive queries
      this.sqlocalInstance = sqlocalDrizzle

      this.appDb = drizzle(
        driver, 
        batchDriver, 
        { 
          schema, 
        })

      logger('[Db.prepareDb] database prepared')

      await this.migrate()

      return this.appDb
    } catch (error) {
      logger('[Db.prepareDb] error', JSON.stringify(error))
      throw error
    }
  }

  // static async prepareDb(filesDir: string) {
  //   console.log('prepareDb', filesDir)
  //   if (Db.sqliteWasmClient) {
  //     return this.dbId
  //   }

  //   this.filesDir = filesDir
  //   this.pathToDb = `${filesDir}/db/${DB_NAME_APP}.db`

  //   if (typeof document === 'undefined') {
  //     return
  //   }

  //   let promiser

  //   try {

  //       let sqlite3Worker1Promiser

  //       const sqliteWasm = await import('@sqlite.org/sqlite-wasm')

  //       if (sqliteWasm && sqliteWasm.sqlite3Worker1Promiser) {
  //         sqlite3Worker1Promiser = sqliteWasm.sqlite3Worker1Promiser
  //       }

  //       if (!sqlite3Worker1Promiser && window.sqlite3Worker1Promiser) {
  //         sqlite3Worker1Promiser = window.sqlite3Worker1Promiser
  //       }

  //       if (!sqlite3Worker1Promiser) {
  //         throw new Error('Failed to load sqlite3Worker1Promiser')
  //       }

  //       promiser = await new Promise<(event: string, config: Record<string, unknown>) => Promise<any>>((resolve) => {
  //         const _promiser = sqlite3Worker1Promiser({
  //           onready: () => {
  //             resolve(_promiser);
  //           },
  //         });
  //       }).catch((error) => {
  //         console.error('Error from sqlite proxy server: ', JSON.stringify(error))
  //       });

  //   } catch ( e ) {
  //     console.error('Error from sqlite proxy server: ', JSON.stringify(e))
  //   }


  //   if (!promiser) {
  //     throw new Error('Failed to create promiser')
  //   }

  //   this.sqliteWasmClient = promiser

  //   const responseGet = await this.sqliteWasmClient('config-get', {});

  //   logger('[Db.prepareDb] Running SQLite3 version', responseGet.result.version.libVersion);

  //   const responseOpen = await this.sqliteWasmClient('open', {
  //     filename: `file:${filesDir}/db/${DB_NAME_APP}.db?vfs=opfs`,
  //   });
  //   const { dbId } = responseOpen;
  //   logger(
  //     '[Db.prepareDb] OPFS is available, created persisted database at',
  //     responseOpen.result.filename.replace(/^file:(.*?)\?vfs=opfs/, '$1'),
  //   );

  //   logger('[Db.prepareDb] dbId', dbId)
    
  //   this.dbId = dbId
    
  //   await this.migrate()
  // }

  static async connectToDb(filesDir: string,): Promise<string | undefined> {



    return this.dbId
  }

  static async copyDrizzleFiles(filesDir: string): Promise<void> {
    logger('[Db.copyDrizzleFiles] copying drizzle migration files')

    try {
      // Ensure db directory exists
      const dbDirPath = `${filesDir}/db`
      await BaseFileManager.createDirIfNotExists(dbDirPath)

      // Ensure meta directory exists
      const metaDirPath = `${dbDirPath}/meta`
      await BaseFileManager.createDirIfNotExists(metaDirPath)

      // Parse journal JSON to get all migration entries
      const journal = JSON.parse(journalJson)
      const entries = journal.entries || []

      if (entries.length === 0) {
        logger('[Db.copyDrizzleFiles] no migration entries found in journal')
        return
      }

      // Copy each migration SQL file (always overwrite to ensure they're up-to-date)
      // Each migration is exported as a separate variable (e.g., migrationSql_0000_married_malice)
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const tag = entry.tag // e.g., "0000_married_malice"
        const migrationFileName = `${tag}.sql`
        const migrationPath = `${dbDirPath}/${migrationFileName}`
        
        // Get the SQL for this migration from the exported variable
        const migrationVarName = `migrationSql_${tag}` as keyof typeof drizzleFiles
        const migrationContent = drizzleFiles[migrationVarName] as string | undefined
        
        if (!migrationContent) {
          logger(`[Db.copyDrizzleFiles] ERROR: No migration content found for ${migrationFileName} (variable: ${migrationVarName})`)
          throw new Error(`No migration content found for ${migrationFileName}. Expected variable: ${migrationVarName}`)
        }
        
        await BaseFileManager.saveFile(migrationPath, migrationContent.trim())
        logger(`[Db.copyDrizzleFiles] copied/updated migration SQL file: ${migrationFileName}`)
      }

      // Copy journal JSON file (always overwrite to ensure it's up-to-date with all migrations)
      const journalPath = `${metaDirPath}/_journal.json`
      await BaseFileManager.saveFile(journalPath, journalJson)
      logger('[Db.copyDrizzleFiles] copied/updated journal JSON file')

      // Copy snapshot JSON file (use the latest snapshot based on the highest idx in journal)
      // Snapshot files are named like: 0000_snapshot.json, 0001_snapshot.json, etc.
      // The tag format is like "0000_married_malice", so we extract the numeric prefix
      const latestEntry = entries[entries.length - 1]
      const tagPrefixMatch = latestEntry.tag.match(/^(\d+_)/)
      const tagPrefix = tagPrefixMatch ? tagPrefixMatch[1] : '0000_'
      const snapshotFileName = `${tagPrefix}snapshot.json`
      const snapshotPath = `${metaDirPath}/${snapshotFileName}`
      // Always overwrite snapshot to ensure it's up-to-date
      await BaseFileManager.saveFile(snapshotPath, snapshotJson)
      logger(`[Db.copyDrizzleFiles] copied/updated snapshot JSON file: ${snapshotFileName}`)

      logger('[Db.copyDrizzleFiles] drizzle files copied successfully')
    } catch (error) {
      logger('[Db.copyDrizzleFiles] error copying drizzle files', error)
      // Don't throw - the files might already exist or migration might work without them
      // The migration will fail later if the files are truly needed
    }
  }

  static async migrate(): Promise<void> {

    if (!this.appDb) {
      throw new Error('Database not prepared')
    }

    const pathToDbDir = `${this.filesDir}/db`

    try {

      logger('[Db.migrate] calling readMigrationFiles')
      
      const migrations = readMigrationFiles({
        migrationsFolder: pathToDbDir,
      })

      logger('[Db.migrate] migrations', migrations)
  
      await drizzleMigrate(
        this.appDb,
        async (queriesToRun) => {
          logger('queriesToRun', queriesToRun)
          for (const query of queriesToRun) {
            logger('query', query)
            await this.appDb?.run(sql.raw(query))
          }
        },
        {
          migrationsFolder: pathToDbDir,
        },
      )

      logger('[Db.migrate] migrations completed')
      
    } catch (error) {
      logger('[Db.migrate] error', JSON.stringify(error))
      throw error
    }
      

  }

  // static async migrate(): Promise<void> {

  //   const schemaGlobString = `${BROWSER_FS_TOP_DIR}/schema/*`
  //   const pathToDbDir = `${this.filesDir}/db`
  //   const dbName = DB_NAME_APP

  //   logger('[Db.migrate] running migrations')

  //   const drizzleDb = drizzle(
  //     async (sql, params,) => {
  //       try {
  //         logger(
  //           `executing sql`,
  //           sql,
  //         )

  //         const finalResult = await this.exec(sql, params)

  //         // logger(`finalResult with method: ${method}`, finalResult)
  //         // Drizzle always waits for {rows: string[][]} or {rows: string[]} for the return value.

  //         // When the method is get,  you should return a value as {rows: string[]}.
  //         // Otherwise, you should return {rows: string[][]}.

  //         return { rows: finalResult }
  //       } catch (e: any) {
  //         console.error('Error from sqlite proxy server: ', JSON.stringify(e))
  //         return { rows: [] }
  //       }
  //     },
  //     {
  //       schema,
  //       // logger: true,
  //     },
  //   )

  //   try {
  //     const zenfs = await BaseFileManager.getFs()

  //     logger('[Db.migrate] calling readMigrationFiles')

  //     const migrations = readMigrationFiles({
  //       migrationsFolder: pathToDbDir,
  //     })

  //     logger('[Db.migrate] migrations', migrations)

  //     if (migrations.length > 0) {
  //       const incomingMigrationHashes = migrations.map(
  //         (migration) => migration.hash,
  //       )

  //       let existingMigrationHashes
  //       let rows = []

  //       try {

  //         const queryMigrationsTable = await drizzleDb.run(
  //           sql.raw(
  //             `SELECT name 
  //              FROM sqlite_master 
  //              WHERE type='table' 
  //              AND name='__drizzle_migrations';`,
  //           ),
  //         )

  //         logger('queryMigrationsTable', queryMigrationsTable)

  //         if (queryMigrationsTable && queryMigrationsTable.rows && queryMigrationsTable.rows.length > 0) {
  //           const query = await drizzleDb.run(
  //             sql.raw(
  //               `SELECT hash, created_at
  //                FROM main.__drizzle_migrations;`,
  //             ),
  //           )
  
  //           rows = query.rows
  //         }

  //       } catch (e) {
  //         rows = []
  //       }

  //       if (rows && rows.length > 0) {
  //         existingMigrationHashes = rows.map((row) => row[0])
  //       }

  //       if (existingMigrationHashes) {
  //         let shouldRebuildDb = false
  //         for (const existingHash of existingMigrationHashes) {
  //           if (!incomingMigrationHashes.includes(existingHash)) {
  //             shouldRebuildDb = true
  //             break
  //           }
  //         }
  //         if (shouldRebuildDb) {
  //           await zenfs.promises.unlink(`${pathToDbDir}/${dbName}.db`)
  //         }
  //       }
  //     }

  //     logger('[Db.migrate] running migrations')

  //     await drizzleMigrate(
  //       drizzleDb,
  //       async (queriesToRun) => {
  //         // logger('queriesToRun', queriesToRun)
  //         for (const query of queriesToRun) {
  //           // logger('query', query)
  //           await drizzleDb.run(sql.raw(query))
  //         }
  //       },
  //       {
  //         migrationsFolder: pathToDbDir,
  //       },
  //     )
  //   } catch (error) {
  //     logger('[Db.migrate] error', JSON.stringify(error))
  //     // await BaseFileManager.waitForFile(`${pathToDbDir}/meta/_journal.json`)

  //     // const journalExists = await BaseFileManager.pathExists(
  //     //   `${pathToDbDir}/meta/_journal.json`,
  //     // )

  //     // if (journalExists) {
  //     //   await this.migrate(pathToDbDir, dbName,)
  //     // }

  //     // if (!journalExists) {
  //     //   throw new Error('Failed to migrate database')
  //     // }


  //   }

  //   this.appDb = drizzleDb

  //   // Old code for migrating the database
  //   // const createTempTableQuery = await appDb.run(
  //   //   sql.raw(
  //   //     `CREATE TEMP TABLE IF NOT EXISTS temp_last_inserted_id (id INTEGER, table TEXT);`,
  //   //   ),
  //   // )
  //   //
  //   // logger(
  //   //   '[db/actors] [migrate] createTempTableQuery',
  //   //   createTempTableQuery,
  //   // )

  //   // const triggersQuery = await appDb.run(
  //   //   sql.raw(
  //   //     `SELECT name
  //   //      FROM main.sqlite_master
  //   //      WHERE type = 'trigger';`,
  //   //   ),
  //   // )
  //   //
  //   // logger('[db/actors] [migrate] triggersQuery', triggersQuery)
  //   //
  //   // const triggers = triggersQuery.rows.map((row) => row[0])
  //   //
  //   // const tablesQuery = await appDb.run(
  //   //   sql.raw(
  //   //     `SELECT name
  //   //      FROM main.sqlite_master
  //   //      WHERE type = 'table';`,
  //   //   ),
  //   // )
  //   //
  //   // logger('[db/actors] [migrate] tablesQuery', tablesQuery)
  //   //
  //   // const tableNames = tablesQuery.rows.map((row) => row[0])
  //   // logger('[db/actors] [migrate] tableNames', tableNames)
  //   // for (const tableName of tableNames) {
  //   //   const triggerName = `after_insert_${tableName}`
  //   //   if (triggers.includes(triggerName)) {
  //   //     continue
  //   //   }
  //   //           const createTriggerQuery = await appDb.run(
  //   //             sql.raw(
  //   //               `CREATE TRIGGER after_insert_${tableName}
  //   // AFTER INSERT ON ${tableName}
  //   // BEGIN
  //   //     DELETE FROM temp_last_inserted_id;
  //   //     INSERT INTO temp_last_inserted_id (id) VALUES (new.id);
  //   // END;`,
  //   //             ),
  //   //           )
  //   //
  //   //           logger(
  //   //             '[db/actors] [migrate] createTriggerQuery',
  //   //             createTriggerQuery,
  //   //           )
  //   //         }
  // }

  // static async exec(sql: string, params: any[]) {
  //   const rowsToReturnRaw: SqliteWasmResult[] = []
  //   const rowsValues: string[][] = []
  
  //   // For a single exec command, the callback potentially gets called several times -- once for each row.
  //   // So we need to collect all rows into a final array to return (execResult).
  //   const rowsToReturn = await new Promise((resolve, reject) => {


  //    this.sqliteWasmClient('exec', {
  //       dbId:this.dbId,
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

  /**
   * Execute a reactive query that emits new results whenever the underlying data changes.
   * 
   * Supports two usage patterns:
   * 1. SQL tag function: liveQuery((sql) => sql`SELECT * FROM models`)
   * 2. Drizzle query builder: liveQuery(db.select().from(models))
   * 
   * @param query - SQL query function or Drizzle query builder
   * @returns Observable that emits arrays of query results
   * 
   * @example
   * ```typescript
   * // Using SQL tag function
   * const models$ = Db.liveQuery<ModelRow>(
   *   (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
   * )
   * 
   * // Using Drizzle query builder
   * const models$ = Db.liveQuery<ModelRow>(
   *   appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
   * )
   * 
   * models$.subscribe(models => {
   *   console.log('Models updated:', models)
   * })
   * ```
   */
  static liveQuery<T>(
    query: ((sql: any) => any) | any
  ): Observable<T[]> {
    if (!this.sqlocalInstance) {
      throw new Error('Database not initialized. Call prepareDb first.')
    }
    
    if (!this.sqlocalInstance.reactiveQuery) {
      throw new Error('Reactive queries not enabled. Initialize SQLocalDrizzle with reactive: true.')
    }

    const baseObservable = new Observable<T[]>((subscriber) => {
      // Call SQLocal's reactiveQuery
      const reactiveQueryResult = this.sqlocalInstance!.reactiveQuery(query)
      
      // Subscribe to SQLocal's subscription API
      const subscription = reactiveQueryResult.subscribe(
        (data: Record<string, any>[]) => {
          // Log the actual data structure for debugging
          if (data && data.length > 0) {
            // Try to extract IDs/names for logging (check common field names)
            const sampleIds = data.map((d: any) => {
              return d.id || d.modelId || d.schemaId || d.modelFileId || d.schemaFileId || d.name || d.modelName || JSON.stringify(d).substring(0, 50)
            })
          }
          // Emit data through RxJS Observable (cast to T[] since SQLocal returns Record<string, any>[])
          subscriber.next(data as T[])
        },
        (err: Error) => {
          console.error('[BaseDb.liveQuery] SQLocal reactiveQuery error:', err)
          // Emit error through RxJS Observable
          subscriber.error(err)
        }
      )
      
      // Cleanup: unsubscribe when Observable is unsubscribed
      return () => {
        subscription.unsubscribe()
      }
    })
    
    // Use distinctUntilChanged with JSON.stringify comparison
    // The comparator returns true if values are the same (skip emission)
    return baseObservable.pipe(
      distinctUntilChanged((prev, curr) => {
        // On first emission, prev will be undefined, so we always emit
        if (prev === undefined) {
          return false // false = different, so emit
        }
        
        // Compare using JSON.stringify
        try {
          const prevJson = JSON.stringify(prev)
          const currJson = JSON.stringify(curr)
          // Return true if same (skip), false if different (emit)
          return prevJson === currJson
        } catch (error) {
          // If JSON.stringify fails, fall back to reference equality
          console.warn('[BaseDb.liveQuery] distinctUntilChanged: JSON.stringify failed, using reference equality', error)
          return prev === curr
        }
      })
    )
  }
}

export { Db }
