import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'
import { DrizzleConfig } from 'drizzle-orm'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'

dotenv.config()

const pathResolver = BasePathResolver.getInstance()

const {
  appSchemaDir,
  dotSeedDir,
} = pathResolver.getAppPaths()

export default defineConfig({
  schema: appSchemaDir,
  dialect: 'sqlite',
  out: `${dotSeedDir}/db`,
  dbCredentials: {
    url: `${dotSeedDir}/db/app_db.sqlite3`,
  },
}) as DrizzleConfig
