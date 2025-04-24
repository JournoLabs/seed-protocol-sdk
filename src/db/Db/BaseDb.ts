import { IDb } from '@/interfaces/IDb'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

export abstract class BaseDb implements IDb {

  constructor() {
  }

  static PlatformClass: typeof BaseDb

  static setPlatformClass(platformClass: typeof BaseDb) {
    this.PlatformClass = platformClass
  }

  static getAppDb(): BaseSQLiteDatabase {
    return this.PlatformClass.getAppDb()
  }

  static prepareDb(filesDir: string): Promise<BaseSQLiteDatabase> {
    return this.PlatformClass.prepareDb(filesDir)
  }

  static isAppDbReady(): boolean {
    return this.PlatformClass.isAppDbReady()
  }

  static connectToDb(pathToDir: string,): Promise<unknown> {
    return this.PlatformClass.connectToDb(pathToDir,)
  }

  static async migrate(pathToDbDir: string, dbName: string, dbId: string): Promise<void> {
    return this.PlatformClass.migrate(pathToDbDir, dbName, dbId)
  }

}