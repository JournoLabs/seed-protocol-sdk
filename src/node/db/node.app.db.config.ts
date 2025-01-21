import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'
import process from 'node:process'
import path from 'path'
import { DrizzleConfig } from 'drizzle-orm'

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
    'browser',
    'project',
    '.seed',
  )
}

let schemaDir = `${sdkRoot}/dist/seedSchema/*.ts`

if (process.env.IS_SEED_DEV) {
  schemaDir = `${sdkRoot}/seedSchema/*.ts`
}

export default defineConfig({
  schema: schemaDir,
  dialect: 'sqlite',
  out: `${dotSeedDir}/db`,
  dbCredentials: {
    url: `${dotSeedDir}/db/app_db.sqlite3`,
  },
}) as DrizzleConfig
