import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'
import { DrizzleConfig } from 'drizzle-orm'
import { PathResolver } from '../PathResolver'

dotenv.config()

const pathResolver = PathResolver.getInstance()

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
