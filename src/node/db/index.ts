export * from '@/db/configs/seed.schema.config'
export * from '@/db/configs/browser.app.db.config'
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import nodeAppDbConfig from '@/node/db/node.app.db.config'

let appDb: BetterSQLite3Database | undefined

export const getAppDb = () => {
  if (!appDb) {
    appDb = drizzle(nodeAppDbConfig)
  }

  return appDb
}
