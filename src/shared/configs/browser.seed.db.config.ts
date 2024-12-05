import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'
import process from 'node:process'
import path from 'path'

dotenv.config()

let sdkRoot = './node_modules/@seedprotocol/sdk'

if (process.env.IS_SEED_DEV) {
  sdkRoot = './src'
}

let dotSeedDir = path.join(process.cwd(), '.seed')

if (process.env.IS_SEED_DEV) {
  dotSeedDir = path.join(
    process.cwd(),
    '__tests__',
    '__mocks__',
    'project',
    '.seed',
  )
}

export default defineConfig({
  schema: `${sdkRoot}/browser/db/seedSchema/*Schema.ts`,
  dialect: 'sqlite',
  out: `${dotSeedDir}/seed/db`,
  dbCredentials: {
    url: `${dotSeedDir}/seed/db/seed_db.sqlite3`,
  },
})
