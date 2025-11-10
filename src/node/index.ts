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
} from '../schema'

// Core classes
export { BaseItem as Item } from '../Item/BaseItem'
export { BaseItemProperty as ItemProperty } from '../ItemProperty/BaseItemProperty'

// Node.js specific exports
export { FileManager } from './helpers/FileManager'
export { Db } from './db/Db'
export { Item as NodeItem } from './Item/Item'
export { ItemProperty as NodeItemProperty } from './ItemProperty/ItemProperty'

// Schema exports
export { models, versions, seeds, metadata, appState, config, modelUids } from '../seedSchema'

// Store exports
export { getModels, getModel, getModelNames } from '../stores/modelClass'

// Helper exports
export { getCorrectId } from '../helpers'

// Event bus
export { eventEmitter } from '../eventBus'

// Webpack helper
export { withSeed } from './webpack'

// Types
export type { PublishUpload } from '../db/read/getPublishUploads'

// Client
export { client } from '../client'

// All types
export * from '../types'

// CLI exports
export { PathResolver } from './helpers/PathResolver'
export { BasePathResolver } from '../helpers/PathResolver/BasePathResolver'
export { getTsImport } from './helpers'
export { commandExists } from '../helpers/scripts'
export { INIT_SCRIPT_SUCCESS_MESSAGE, SCHEMA_TS } from '../helpers/constants'
// Note: Codegen functions (createDrizzleSchemaFilesFromConfig, generateModelCode) are not exported
// to avoid bundling nunjucks/fsevents. Import directly from './codegen/drizzle' if needed for CLI scripts.

// Side effect imports for CLI
import './helpers/EasClient'
import './helpers/QueryClient'
import './helpers/FileManager'
import './helpers/ArweaveClient'
import './helpers/PathResolver'

enableMapSet() 