import { enableMapSet } from 'immer'

// Core schema exports
export {
  Model,
  Property,
  Image,
  List,
  Text,
  Json,
  Relation,
  Boolean,
  Number,
  Date,
} from '../Schema'

// Core classes
export { Item } from '../Item/Item'
export { ItemProperty } from '../ItemProperty/ItemProperty'

// Node.js specific exports
export { FileManager } from './helpers/FileManager'
export { Db } from './db/Db'

// Schema exports
export { models, versions, seeds, metadata, appState, config, modelUids } from '../seedSchema'

// Model access - use Model static methods instead
// Models are accessible via Model.all(), Model.getById(), Model.getByName(), etc.

// Helper exports
export { getCorrectId } from '../helpers'

// Import exports
export * from '../imports'

// Event bus
export { eventEmitter } from '../eventBus'

// Webpack helper
export { withSeed } from './webpack'

// Types
// Note: PublishUpload type is available from '../db/read/getPublishUploads'
// Type-only exports cause issues with Rollup's parser. Import directly if needed:
// import type { PublishUpload } from '@seedprotocol/sdk/db/read/getPublishUploads'

// Client
export { client } from '../client'

// All types
export * from '../types'

// CLI exports
export { PathResolver } from './helpers/PathResolver'
export { BasePathResolver } from '../helpers/PathResolver/BasePathResolver'
export { getTsImport } from './helpers'
export { commandExists, runSeedInit, findSeedBinary } from './helpers/scripts'
export { INIT_SCRIPT_SUCCESS_MESSAGE, SCHEMA_TS } from '../helpers/constants'
// Codegen functions exported for CLI usage (Node.js only, so bundling concerns don't apply)
export { createDrizzleSchemaFilesFromConfig, generateModelCode } from './codegen/drizzle'

// Side effect imports for CLI
import './helpers/EasClient'
import './helpers/QueryClient'
import './helpers/FileManager'
import './helpers/ArweaveClient'
import './helpers/PathResolver'

enableMapSet() 