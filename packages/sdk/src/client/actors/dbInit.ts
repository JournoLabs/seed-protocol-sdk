import { ClientManagerContext } from "@/types/machines"
import { BaseDb } from "@/db/Db/BaseDb"
import debug from "debug"

const logger = debug('seedSdk:client:actors:dbInit')

/** Init step: opens and migrates the app database (BaseDb.prepareDb). */
export async function dbInit({ filesDir, dbConfig }: ClientManagerContext): Promise<void> {
  if (!filesDir) {
    throw new Error('filesDir is required')
  }
  await BaseDb.prepareDb(filesDir, dbConfig)
  if (!BaseDb.getAppDb()) {
    throw new Error('Database not available after preparation')
  }
  logger('Database prepared and ready')
}
