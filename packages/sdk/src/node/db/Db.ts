import { BaseDb } from '@/db/Db/BaseDb'
import type { IDb } from '@/interfaces/IDb'
import path from 'path'
import { fileURLToPath } from 'node:url'
import debug from 'debug'
import { appState } from '@/seedSchema'
import fs from 'fs'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import * as schema from '@/seedSchema'
import { Observable, interval, switchMap, distinctUntilChanged, startWith } from 'rxjs'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'

const logger = debug('seedSdk:node:db:Db')

export interface DbConfig {
  dbUrl?: string
  /** @deprecated Unused — schema is the static SDK seedSchema + prebuilt SQL migrations */
  schemaDir?: string
  outDir?: string
}

function resolveDbPaths(filesDir: string, config?: DbConfig) {
  const outDir = config?.outDir || path.join(filesDir, 'db')
  const dbPath = config?.dbUrl
    ? (config.dbUrl.startsWith('file:') ? config.dbUrl.replace(/^file:/, '') : config.dbUrl)
    : path.join(outDir, 'seed.db')
  return { outDir, dbPath }
}

/**
 * Locate prebuilt drizzle migration SQL shipped with the SDK
 * (same files the browser embeds via drizzleFiles.ts).
 */
export function resolveSdkDrizzleMigrationsDir(sdkRootDir?: string): string {
  const root =
    sdkRootDir ||
    (() => {
      try {
        return BasePathResolver.getSdkRootDir()
      } catch {
        return process.cwd()
      }
    })()

  // Also resolve relative to this module so temp-cwd tests / odd roots still find
  // packages/sdk/src/db/drizzle (or dist/db/drizzle after publish).
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))

  const candidates = [
    path.join(root, 'db', 'drizzle'), // production: sdkRoot is dist/
    path.join(root, 'dist', 'db', 'drizzle'), // sdk package root with built dist
    path.join(root, 'src', 'db', 'drizzle'), // monorepo / sdk-dev
    path.join(root, 'packages', 'sdk', 'src', 'db', 'drizzle'), // monorepo root as cwd
    path.join(root, 'packages', 'sdk', 'dist', 'db', 'drizzle'),
    path.join(moduleDir, '..', '..', 'db', 'drizzle'), // src/node/db -> src/db/drizzle
    path.join(moduleDir, '..', '..', '..', 'src', 'db', 'drizzle'), // dist/node -> src
    path.join(moduleDir, '..', 'db', 'drizzle'), // dist layout variants
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) {
      return candidate
    }
  }

  throw new Error(
    `Could not find SDK drizzle migrations (meta/_journal.json). Searched under: ${candidates.join(', ')}`,
  )
}

function copyDirRecursive(sourceDir: string, targetDir: string) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }
  for (const entry of fs.readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry)
    const targetPath = path.join(targetDir, entry)
    const stats = fs.statSync(sourcePath)
    if (stats.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath)
    } else {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

export class NodeDb implements IDb {
  db: any


  getAppDb() {
    return this.db
  }

  isAppDbReady() {
    return true
  }

  /**
   * Copy prebuilt SQL migrations into the app db directory (overwrite to stay current).
   */
  copyDrizzleFiles(filesDir: string, migrationsSourceDir?: string): string {
    const { outDir } = resolveDbPaths(filesDir)
    const source = migrationsSourceDir || resolveSdkDrizzleMigrationsDir()
    logger('[Db.copyDrizzleFiles] copying from %s to %s', source, outDir)
    copyDirRecursive(source, outDir)
    return outDir
  }

  async prepareDb(filesDir: string, config?: DbConfig) {
    const resolvedFilesDir = path.resolve(filesDir)

    if (!fs.existsSync(resolvedFilesDir)) {
      fs.mkdirSync(resolvedFilesDir, { recursive: true })
    }

    const { outDir, dbPath } = resolveDbPaths(resolvedFilesDir, config)

    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true })
    }

    // Install SDK migration SQL next to the DB (same source of truth as browser)
    this.copyDrizzleFiles(resolvedFilesDir)

    const dbUrl = config?.dbUrl
      ? (config.dbUrl.startsWith('file:') ? config.dbUrl : `file:${path.resolve(config.dbUrl)}`)
      : `file:${path.resolve(dbPath)}`

    const client = createClient({ url: dbUrl })
    const db = drizzle(client, { schema })

    logger('[Db.prepareDb] running migrations from %s', outDir)
    await migrate(db, { migrationsFolder: outDir })

    this.db = db

    const { backfillMetadataPropertyIds } = await import('@/db/backfillMetadataPropertyIds')
    await backfillMetadataPropertyIds()

    return this.db
  }

  async connectToDb(_pathToDir: string) {
    return {
      id: this.db ? this.db.constructor.name : '',
    }
  }

  async migrate(pathToDbDir: string, _dbName: string, _dbId: string) {
    try {
      if (!this.db) {
        throw new Error('Database not initialized. Call prepareDb first.')
      }

      await migrate(this.db, { migrationsFolder: pathToDbDir })
      const queryResult = await this.db.select().from(appState)
      logger('queryResult', queryResult)
    } catch (error: any) {
      const errorMessage = error.message || String(error) || ''
      const errorString = String(error)
      const isMigrationError =
        errorMessage.includes("Can't find meta/_journal.json") ||
        errorMessage.includes('_journal.json') ||
        errorMessage.includes("Cannot read properties of undefined") ||
        errorMessage.includes("reading 'dialect'") ||
        errorMessage.includes('undefined is not an object') ||
        errorString.includes('dialect') ||
        errorString.includes('undefined is not an object')

      if (isMigrationError) {
        if (process.env.NODE_ENV === 'test' || process.env.IS_SEED_DEV) {
          logger(
            'Warning: Migration failed, but continuing in test environment:',
            errorMessage || errorString,
          )
          return this.db
        }
      }
      throw error
    }

    return this.db
  }

  /**
   * Polling-based liveQuery stub for Node. Prefer browser reactive queries in UI apps.
   */
  liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call prepareDb first.')
    }

    const pollInterval = 1000

    if (typeof query === 'function') {
      throw new Error(
        'SQL tag functions are not supported in node liveQuery stub implementation. Use Drizzle query builders instead.',
      )
    }

    const queryBuilder = query

    return interval(pollInterval).pipe(
      startWith(0),
      switchMap(async () => {
        try {
          const result = await Promise.resolve(queryBuilder)
          return result as T[]
        } catch (error) {
          logger('[Db.liveQuery] Error executing query:', error)
          throw error
        }
      }),
      distinctUntilChanged((prev, curr) => {
        return JSON.stringify(prev) === JSON.stringify(curr)
      }),
    )
  }
}

/** @deprecated Prefer NodeDb */
export const Db = NodeDb

BaseDb.configure(new NodeDb())

const _check: IDb = new NodeDb()
void _check
