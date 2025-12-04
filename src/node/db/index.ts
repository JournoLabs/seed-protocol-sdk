export * from '@/db/configs/seed.schema.config'
export * from '@/db/configs/browser.app.db.config'
// OLD CODE: import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import nodeAppDbConfig from '@/db/configs/node.app.db.config'
import path from 'path'

// OLD CODE: let appDb: BetterSQLite3Database | undefined
let appDb: any | undefined

export const getAppDb = () => {
  if (!appDb) {
    // OLD CODE: appDb = drizzle(nodeAppDbConfig)
    
    // NEW CODE: Create libsql client from config and pass to drizzle
    const dbUrl = nodeAppDbConfig.dbCredentials?.url
    if (!dbUrl) {
      throw new Error('Database URL not found in config')
    }
    
    // Convert file path to file: URL for libsql if needed
    const clientUrl = dbUrl.startsWith('file:') ? dbUrl : `file:${path.resolve(dbUrl)}`
    const client = createClient({ url: clientUrl })
    appDb = drizzle(client)
  }

  return appDb
}
