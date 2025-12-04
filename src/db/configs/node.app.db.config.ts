import { defineConfig } from 'drizzle-kit'
import dotenv from 'dotenv'
import { BasePathResolver } from '@/helpers/PathResolver/BasePathResolver'

dotenv.config()

// Use PathResolver to get the correct .seed directory path regardless of environment
// If SEED_DOT_SEED_DIR is set (e.g., by Db.ts), use it; otherwise use PathResolver
const pathResolver = BasePathResolver.getInstance()
const dotSeedDir = process.env.SEED_DOT_SEED_DIR || pathResolver.getDotSeedDir()

// Export a function that can be called with a custom dotSeedDir, or use the default
export const getDrizzleConfig = (customDotSeedDir?: string) => {
  const seedDir = customDotSeedDir || dotSeedDir
  return defineConfig({
    schema: [`${seedDir}/schema/*Schema.ts`],
    dialect: 'sqlite',
    out: `${seedDir}/db`,
    dbCredentials: {
      url: `${seedDir}/db/seed.db`,
    },
  })
}

// Default export for drizzle-kit CLI usage
export default getDrizzleConfig()
