import { BaseDb }         from "@/db/Db/BaseDb";
import { IDb }            from "@/interfaces";
import path               from "path";
import { DrizzleConfig, } from "drizzle-orm";
import { isBrowser }      from '@/helpers/environment'
import debug from 'debug'
import { appState } from '@/seedSchema'

const logger = debug('seedSdk:node:db:Db')

const getConfig = async (dotSeedDir: string) => {

  const { defineConfig } = await import('drizzle-kit')

  let schemaDir = `${dotSeedDir}/schema/*Schema.ts`
  if (!isBrowser()) {
    schemaDir = path.join(process.cwd(), 'schema')
  }

  const nodeDbConfig = defineConfig({
    schema: schemaDir,
    dialect: 'sqlite',
    out: `${dotSeedDir}/db`,
    dbCredentials: {
      url: `${dotSeedDir}/db/app_db.sqlite3`,
    }
  }) as DrizzleConfig & { dbCredentials: { url: string } }

  return nodeDbConfig
}

class Db extends BaseDb implements IDb {
  static db: any

  constructor() {
    super()
  }

  static getAppDb() {
    return this.db
  }

  static isAppDbReady() {
    return true
  }

  static async prepareDb(filesDir: string) {
    const nodeDbConfig = await getConfig(filesDir)

    const {drizzle} = await import('drizzle-orm/better-sqlite3')

    this.db = drizzle({
      ...nodeDbConfig,
      logger: true,
    })

    if (!this.db) {
      throw new Error('Db not found')
    }

    return this.db
  }

  static async connectToDb(pathToDir: string, dbName: string) {

    return {
      id: this.db.constructor.name
    }
  }

  static async migrate(pathToDbDir: string, dbName: string, dbId: string) {
    const {migrate} = await import('drizzle-orm/better-sqlite3/migrator')
    migrate(this.db, { migrationsFolder: pathToDbDir })
    const queryResult = await this.db.select().from(appState)
    logger('queryResult', queryResult)

    return this.db
  }
}

BaseDb.setPlatformClass(Db)

export { Db }
