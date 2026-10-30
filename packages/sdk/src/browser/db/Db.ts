import { IDb } from "@/interfaces/IDb";
import debug from "debug";
import { drizzle, SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { applyEmbeddedMigrations, canRunInTransaction, getEmbeddedMigrations } from "./embeddedMigrations"
import { withSqliteBusyRetry } from "./sqliteBusyRetry"
import { countDbStatements, countLiveQueryRuns } from "@/helpers/timing"
import { withSeedDbLock } from "@/helpers/tabLocks"
import { sql } from "drizzle-orm"
import { BaseFileManager } from "@/helpers";
import { DatabaseNotPersistentError } from "@/helpers/FileManager/errors";
import * as schema from '@/seedSchema'
import { SQLocalDrizzle } from 'sqlocal/drizzle'
import type { Sqlite3Method } from 'sqlocal'
import * as drizzleFiles from './drizzleFiles'
import { journalJson, snapshotJson } from './drizzleFiles'
import { createSqlocalDrizzle, raceSqlocalStartup } from './createSqlocalDrizzle'
import { startChangeFeed, stopChangeFeed } from './changeFeed'
import { recreateBackupPath, recreateIfOlderThanMinimumUpgradeVersion } from '@/db/minimumUpgradeVersion'
import { Observable, ReplaySubject, distinctUntilChanged, finalize, share, throwError } from 'rxjs'
const logger = debug('seedSdk:browser:db:Db')


export class BrowserDb implements IDb {

  filesDir: string | undefined
  appDb: SqliteRemoteDatabase<Record<string, unknown>> | undefined
  sqlocalInstance: SQLocalDrizzle | undefined
  /** Live queries by SQL + params while they have subscribers; see liveQuery. */
  private sharedLiveQueries = new Map<string, Observable<unknown[]>>()
  /** Bumped by close(), so a prepareDb that was running closes what it opened instead of keeping it. */
  private openGeneration = 0


  getAppDb() {
    return this.appDb
  }

  isAppDbReady() {
    return !!this.appDb
  }

  async prepareDb(filesDir: string) {

    logger('[Db.prepareDb] preparing database')

    this.filesDir = filesDir

    // Another tab may be preparing the same database: run file copies, migrations and the
    // one-time data fixes one tab at a time. See docs/MULTI_TAB.md.
    return withSeedDbLock('migrate', filesDir, () => this.prepareDbLocked(filesDir))
  }

  /**
   * Starts SQLocal on `<filesDir>/db/seed.db` and checks it opened the OPFS file. SQLocal opens an
   * in-memory database instead when its OPFS open throws, which also happens when another tab keeps
   * the file's sync access handle for longer than sqlite-wasm retries (about 4.5 s), e.g. while that
   * tab runs its first queries after migrating. That clears up, so a memory database is closed and
   * the open tried again, waiting 1, 2 and 4 s, before it's reported as DatabaseNotPersistentError.
   */
  private async openPersistentSqlocal() {
    const retryWaitsMs = [1000, 2000, 4000]
    for (let attempt = 0; ; attempt++) {
      // reactive: true enables reactive queries. Blob-wrap sqlocal's HTTPS module worker so Chrome
      // profiles that kill `new Worker(https://…/worker-HASH.js, { type: 'module' })` as an entry
      // still reach connect via `import` of the same URL.
      const { instance: sqlocalDrizzle, workerFailed } = createSqlocalDrizzle(
        () => new SQLocalDrizzle({
          databasePath: `${this.filesDir}/db/seed.db`,
          reactive: true,
        }),
      )
      const { storageType } = await raceSqlocalStartup(sqlocalDrizzle.getDatabaseInfo(), workerFailed)
      if (storageType === 'opfs') return { sqlocalDrizzle, workerFailed }

      await sqlocalDrizzle.destroy().catch(() => {})
      const waitMs = retryWaitsMs[attempt]
      if (waitMs === undefined) {
        throw new DatabaseNotPersistentError(
          `SQLocal opened a "${storageType}" database instead of OPFS`,
          globalThis.crossOriginIsolated === true ? 'vfs' : 'headers',
        )
      }
      logger(`[Db.prepareDb] SQLocal opened a "${storageType}" database; retrying in ${waitMs} ms`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }

  private async prepareDbLocked(filesDir: string) {
    const generation = this.openGeneration
    try {
      // A database left open by an init that failed after opening it: close it, or this would
      // start a second SQLocal worker on the same file.
      await this.closeOpenDb()

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

      // SQLite's OPFS VFS needs SharedArrayBuffer and Atomics. Without them SQLocal quietly
      // opens an in-memory database, so fail before starting the worker.
      if (typeof SharedArrayBuffer === 'undefined' || typeof Atomics === 'undefined') {
        throw new DatabaseNotPersistentError(
          globalThis.crossOriginIsolated === false
            ? 'the page is not cross-origin isolated, so SharedArrayBuffer is unavailable'
            : 'SharedArrayBuffer is unavailable',
        )
      }

      const { sqlocalDrizzle, workerFailed } = await this.openPersistentSqlocal()
      const closedMeanwhile = async () => {
        if (generation === this.openGeneration) return
        if (this.sqlocalInstance === sqlocalDrizzle) await this.closeOpenDb()
        else await sqlocalDrizzle.destroy().catch(() => {})
        throw new Error('The database was closed while it was being opened')
      }
      await closedMeanwhile()

      const { batchDriver } = sqlocalDrizzle
      const driver = countDbStatements(withSqliteBusyRetry(sqlocalDrizzle.driver))

      // Store SQLocalDrizzle instance for reactive queries
      this.sqlocalInstance = sqlocalDrizzle
      // Shared live queries still open belong to the previous instance; new calls start fresh.
      this.sharedLiveQueries.clear()

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

      await raceSqlocalStartup((async () => {
        await recreateIfOlderThanMinimumUpgradeVersion(db, {
          backupPath: recreateBackupPath(`${filesDir}/db/seed.db`),
        })
        await this.runMigrations(db)
        await closedMeanwhile()

        this.appDb = db

        // Loaded Items and ItemProperties hear about row changes through it (ADR 0020). Started
        // after the migrations above, so their log rows aren't dispatched.
        await startChangeFeed(db, { liveQuery: (query) => this.liveQuery(query) })
      })(), workerFailed)

      return this.appDb
    } catch (error) {
      logger('[Db.prepareDb] error', JSON.stringify(error))
      throw error
    }
  }

  async close(): Promise<void> {
    this.openGeneration++
    await this.closeOpenDb()
  }

  /** Destroys the SQLocal instance (its worker releases seed.db) and forgets the database. */
  private async closeOpenDb(): Promise<void> {
    stopChangeFeed()
    const instance = this.sqlocalInstance
    this.appDb = undefined
    this.sqlocalInstance = undefined
    this.sharedLiveQueries.clear()
    if (instance) await instance.destroy().catch((error) => logger('[Db.close] destroy failed', error))
  }

  async connectToDb(_filesDir: string): Promise<string | undefined> {
    return undefined
  }

  async copyDrizzleFiles(filesDir: string): Promise<void> {
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
  private async runMigrations(
    db: SqliteRemoteDatabase<Record<string, unknown>>,
    _pathToDbDir?: string
  ): Promise<void> {
    try {
      const migrations = getEmbeddedMigrations()
      logger('[Db.runMigrations] embedded migrations', migrations.length)
      await applyEmbeddedMigrations(db, migrations, undefined, (queries, migration) =>
        this.runMigrationQueries(db, queries, canRunInTransaction(migration)),
      )
      logger('[Db.runMigrations] migrations completed')
    } catch (error) {
      logger('[Db.runMigrations] error', JSON.stringify(error))
      throw error
    }
  }

  /** Applies a migration atomically through SQLocal's transaction (exclusive across tabs) when SQLite allows. */
  private async runMigrationQueries(
    db: SqliteRemoteDatabase<Record<string, unknown>>,
    queries: string[],
    atomic: boolean,
  ): Promise<void> {
    const statements = queries.filter((query) => query.trim() !== '')
    if (!atomic || !this.sqlocalInstance) {
      for (const query of statements) {
        await db.run(sql.raw(query))
      }
      return
    }
    type TransactionQuery = (statement: { sql: string; params: unknown[] }) => Promise<unknown>
    await this.sqlocalInstance.transaction(async (tx: { query: TransactionQuery }) => {
      for (const query of statements) {
        await tx.query({ sql: query, params: [] })
      }
    })
  }

  /**
   * One SQLocal transaction (Drizzle's own `transaction()` isn't isolated over the SQLocal
   * driver). `fn` gets a Drizzle database whose statements SQLocal runs in the transaction: each
   * is handed to the transaction's `query` shaped as a Drizzle statement, so SQLocal tags it with
   * the transaction and runs it through its driver, and the raw result goes back to Drizzle.
   */
  async transaction<T>(fn: (tx: SqliteRemoteDatabase<Record<string, unknown>>) => Promise<T>): Promise<T> {
    const sqlocal = this.sqlocalInstance
    if (!sqlocal || !this.appDb) throw new Error('Database not prepared')
    return sqlocal.transaction(async (handle) => {
      const txDriver = async (sqlText: string, params: unknown[], method: Sqlite3Method) => {
        const statement = {
          getSQL: () => undefined,
          toSQL: () => ({ sql: sqlText, params }),
          // Called synchronously by `query` right after it queues the transaction's key, which
          // the driver takes before its first await.
          all: () => sqlocal.driver(sqlText, params, method),
        }
        return (await handle.query(statement as never)) as unknown as { rows: any[] }
      }
      return fn(drizzle(txDriver, { schema }))
    })
  }

  async migrate(pathToDbDir: string, _dbName: string, _dbId: string): Promise<void> {
    const targetDb = this.appDb
    if (!targetDb) {
      throw new Error('Database not prepared')
    }
    await this.runMigrations(targetDb, pathToDbDir)
  }

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
  liveQuery<T>(
    query: ((sql: any) => any) | any
  ): Observable<T[]> {
    if (!this.sqlocalInstance) {
      throw new Error('Database not initialized. Call prepareDb first.')
    }
    
    if (!this.sqlocalInstance.reactiveQuery) {
      throw new Error('Reactive queries not enabled. Initialize SQLocalDrizzle with reactive: true.')
    }

    // Resolve an SQL tag function here, with the same tag SQLocal uses, so the statement's SQL and
    // params are known before any query runs and identical live queries can share one.
    let statement: any
    try {
      statement = typeof query === 'function' ? query(sqlTag) : query
    } catch (error) {
      return throwError(() => error)
    }
    const key = liveQueryKey(statement)
    const existing = key ? this.sharedLiveQueries.get(key) : undefined
    if (existing) return existing as Observable<T[]>

    const baseObservable = new Observable<T[]>((subscriber) => {
      // Setup errors (bad SQL, a closed database) go to the subscriber like query errors, so
      // callers see them as an error notification rather than only in the console.
      let subscription: { unsubscribe: () => void }
      const countRun = countLiveQueryRuns()
      try {
        subscription = this.sqlocalInstance!.reactiveQuery(statement).subscribe(
          (data: Record<string, any>[]) => {
            countRun()
            subscriber.next(data as T[])
          },
          (err: Error) => {
            logger('[BaseDb.liveQuery] SQLocal reactiveQuery error:', err)
            subscriber.error(err)
          }
        )
      } catch (error) {
        logger('[BaseDb.liveQuery] SQLocal reactiveQuery setup failed:', error)
        subscriber.error(error)
        return
      }

      return () => {
        subscription.unsubscribe()
      }
    })

    // Compare stable JSON snapshots via keySelector. SQLocal may reuse one array reference
    // and mutate rows in place; comparing (prev, curr) on the same reference makes
    // JSON.stringify(prev) === JSON.stringify(curr) after mutation and suppresses emissions.
    const distinct = baseObservable.pipe(
      distinctUntilChanged(
        (a, b) => a === b,
        (x: T[]) => JSON.stringify(x)
      )
    )
    if (!key) return distinct

    // Every caller with the same SQL and params gets this observable: one SQLocal reactiveQuery
    // (one run per table change) however many subscribe. A late subscriber gets the last rows at
    // once. When the last subscriber leaves, the reactiveQuery closes and the entry is dropped,
    // so the next call starts a fresh query.
    const shared: Observable<T[]> = distinct.pipe(
      finalize(() => {
        if (this.sharedLiveQueries.get(key) === shared) this.sharedLiveQueries.delete(key)
      }),
      share({ connector: () => new ReplaySubject<T[]>(1) }),
    )
    this.sharedLiveQueries.set(key, shared)
    return shared
  }
}

/** SQLocal's own SQL tag (sqlocal/dist/lib/sql-tag.js), which the package does not export. */
function sqlTag(queryTemplate: TemplateStringsArray, ...params: unknown[]) {
  return { sql: queryTemplate.join('?'), params }
}

/**
 * Identifies a live query by its SQL and bound params. Undefined (not shared) for a Drizzle query
 * builder, whose row mapping depends on its select object and not only on the SQL text, and when
 * the params can't be serialized.
 */
function liveQueryKey(statement: any): string | undefined {
  if (typeof statement?.getSQL === 'function') return undefined
  try {
    const { sql, params } = statement ?? {}
    if (typeof sql !== 'string') return undefined
    return JSON.stringify([sql, params ?? []])
  } catch {
    return undefined
  }
}
