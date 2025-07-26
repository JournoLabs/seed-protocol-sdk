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
  schema: [`${dotSeedDir}/schema/*Schema.ts`],
  dialect: 'sqlite',
  out: `${dotSeedDir}/db`,
  dbCredentials: {
    url: `${dotSeedDir}/db/app_db.sqlite3`,
  },
})
