import { BaseDb } from "@/db/Db/BaseDb";
import { IDb } from "@/interfaces";
import nodeAppDbConfig from "./node.app.db.config";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { defineConfig, } from "drizzle-kit";
import path from "path";
import { DrizzleConfig, } from "drizzle-orm";
import Database from "better-sqlite3";

const getConfig = (filesDir: string) => {

  const dotSeedDir = path.join(filesDir, '.seed')
  let schemaDir = `${dotSeedDir}/schema/*Schema.ts`

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
  constructor() {
    super()
  }

  static getAppDb() {
    return drizzle(nodeAppDbConfig)
  }

  static isAppDbReady() {
    return true
  }

  static async prepareDb(filesDir: string) {
    const nodeDbConfig = getConfig(filesDir)

    let db

    try {
      db = drizzle(nodeDbConfig)
    } catch (error) {
      console.error(error)
    }

    try {
      const client = new Database(nodeDbConfig.dbCredentials.url)
      db = drizzle({ client })
    } catch (error) {
      console.error(error)
    }

    return db
  }

  static async connectToDb(pathToDir: string, dbName: string) {

    const nodeDbConfig = getConfig(pathToDir)

    return {
      id: drizzle(nodeDbConfig).$client.name
    }
  }

  static async migrate(pathToDbDir: string, dbName: string, dbId: string) {
    const nodeDbConfig = getConfig(pathToDbDir)
    return drizzle(nodeDbConfig)
  }
}

BaseDb.setPlatformClass(Db)

export { Db }