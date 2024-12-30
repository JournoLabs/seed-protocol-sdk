import path from 'path'
import 'dotenv/config'

export const NODE_APP_DB_CONFIG = 'node.app.db.config.ts'

const currentDir = path.dirname(new URL(import.meta.url).pathname)

const parentToCheck = path.join(currentDir, '..')

let rootWithNodeModules = path.join(currentDir, '..', '..', '..', '..')

if (process.env.IS_SEED_DEV) {
  rootWithNodeModules = path.join(parentToCheck, '..')
}

let sdkRootDir = path.join(
  rootWithNodeModules,
  'node_modules',
  '@seedprotocol',
  'sdk',
  'dist',
)

if (process.env.IS_SEED_DEV) {
  sdkRootDir = path.join(rootWithNodeModules, 'src')
}

let dotSeedDir = path.join(rootWithNodeModules, '.seed')

if (process.env.IS_SEED_DEV) {
  dotSeedDir = path.join(
    process.cwd(),
    '__tests__',
    '__mocks__',
    'project',
    '.seed',
  )
}

export const drizzleKitPath = path.join(
  rootWithNodeModules,
  'node_modules',
  'drizzle-kit',
  'bin.cjs',
)

// App file paths. These are the single source of truth for the SDK user's data model
export const appSchemaDir = path.join(dotSeedDir, 'schema')
export const appDbDir = path.join(dotSeedDir, 'db')
export const appMetaDir = path.join(appDbDir, 'meta')
export const appGeneratedSchemaDir = path.join(dotSeedDir, 'schema')

export const drizzleDbConfigPath = path.join(
  sdkRootDir,
  'node',
  'db',
  NODE_APP_DB_CONFIG,
)

export const templatePath = path.join(
  sdkRootDir,
  'node',
  'codegen',
  'templates',
)

export { rootWithNodeModules, sdkRootDir, dotSeedDir }
