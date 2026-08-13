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

      // Create db instance but do NOT set this.appDb yet. restoreFromDb (and other
      // callers of getAppDb()) must not see the db until migrations have completed,
      // otherwise they may query tables (e.g. publish_processes) that don't exist yet.
      const db = drizzle(
        driver,
        batchDriver,
        {
          schema,
        }
      )

      logger('[Db.prepareDb] database prepared')

      await this.runMigrations(db)

      this.appDb = db

      const { backfillMetadataPropertyIds } = await import('@/db/backfillMetadataPropertyIds')
      await backfillMetadataPropertyIds()

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

  /** Internal migration runner. Used by prepareDb before appDb is set. */
  private static async runMigrations(
    db: SqliteRemoteDatabase<Record<string, unknown>>,
    pathToDbDir?: string
  ): Promise<void> {
    const migrationsFolder = pathToDbDir ?? `${this.filesDir}/db`

    try {
      logger('[Db.runMigrations] calling readMigrationFiles')
      const migrations = readMigrationFiles({
        migrationsFolder,
      })
      logger('[Db.runMigrations] migrations', migrations)

      await drizzleMigrate(
        db,
        async (queriesToRun) => {
          logger('queriesToRun', queriesToRun)
          for (const query of queriesToRun) {
            logger('query', query)
            await db.run(sql.raw(query))
          }
        },
        {
          migrationsFolder,
        },
      )
      logger('[Db.runMigrations] migrations completed')
    } catch (error) {
      logger('[Db.runMigrations] error', JSON.stringify(error))
      throw error
    }
  }

  static async migrate(pathToDbDir: string, _dbName: string, _dbId: string): Promise<void> {
    const targetDb = this.appDb
    if (!targetDb) {
      throw new Error('Database not prepared')
    }
    await this.runMigrations(targetDb, pathToDbDir)
  }

  // Legacy commented migrate/exec implementation archived at
  // docs/archive/commented/browser-Db-legacy-migrate.ts.txt

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
      const reactiveQueryResult = this.sqlocalInstance!.reactiveQuery(query)

      const subscription = reactiveQueryResult.subscribe(
        (data: Record<string, any>[]) => {
          subscriber.next(data as T[])
        },
        (err: Error) => {
          console.error('[BaseDb.liveQuery] SQLocal reactiveQuery error:', err)
          subscriber.error(err)
        }
      )

      return () => {
        subscription.unsubscribe()
      }
    })

    // Compare stable JSON snapshots via keySelector. SQLocal may reuse one array reference
    // and mutate rows in place; comparing (prev, curr) on the same reference makes
    // JSON.stringify(prev) === JSON.stringify(curr) after mutation and suppresses emissions.
    return baseObservable.pipe(
      distinctUntilChanged(
        (a, b) => a === b,
        (x: T[]) => JSON.stringify(x)
      )
    )
  }
}

export { Db }
