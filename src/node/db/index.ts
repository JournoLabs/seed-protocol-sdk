// Internal models (Seed, Version, Metadata) are now defined in seed-protocol-v1.json schema
// and loaded automatically via processSchemaFiles
// OLD CODE: import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import path from 'path'

// OLD CODE: let appDb: BetterSQLite3Database | undefined
let appDb: any | undefined

export interface AppDbConfig {
  dbUrl: string
}

export const getAppDb = (config?: AppDbConfig) => {
  if (!appDb) {
    if (!config || !config.dbUrl) {
      throw new Error('Database URL is required. Please provide config with dbUrl when initializing the SDK.')
    }
    
    // Convert file path to file: URL for libsql if needed
    const clientUrl = config.dbUrl.startsWith('file:') ? config.dbUrl : `file:${path.resolve(config.dbUrl)}`
    const client = createClient({ url: clientUrl })
    appDb = drizzle(client)
  }

  return appDb
}
