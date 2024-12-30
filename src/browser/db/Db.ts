import { BaseDb } from "@/db/Db/BaseDb";
import { IDb } from "@/interfaces/IDb";
import { getAppDb, getSqliteWasmClient, isAppDbReady } from "./sqlWasmClient";
import { SqliteConnectionManager } from "@/services/db";
import debug from "debug";

const logger = debug('app:browser:db:Db')

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

  static prepareDb() {

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

  static connectToDb(pathToDir: string, dbName: string) {

    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {

        // TODO: Add a timeout
        // TODO: Add a cancel token to the promise so we can prevent more loops starting while we're checking the successful outcome
        getSqliteWasmClient().then((sqliteWasmClient) => {

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
}

BaseDb.setPlatformClass(Db)

export { Db }