import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'
import process from 'node:process'
import path from 'path'

dotenv.config()

let dotSeedDir = path.join(process.cwd(), '.seed')

if (process.env.IS_SEED_DEV) {
  dotSeedDir = path.join(
    process.cwd(),
    '__tests__',
    '__mocks__',
    'browser',
    'project',
    '.seed',
  )
}

export default defineConfig({
  schema: [`${dotSeedDir}/app/schema/*Schema.ts`],
  dialect: 'sqlite',
  out: `${dotSeedDir}/app/db`,
  dbCredentials: {
    url: `${dotSeedDir}/app/db/app_db.sqlite3`,
  },
})
