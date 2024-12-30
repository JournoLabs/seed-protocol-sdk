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

  static isAppDbReady(): boolean {
    return this.PlatformClass.isAppDbReady()
  }

  static prepareDb(): Promise<unknown> {
    return this.PlatformClass.prepareDb()
  }

  static connectToDb(pathToDir: string, dbName: string): Promise<unknown> {
    return this.PlatformClass.connectToDb(pathToDir, dbName)
  }

}