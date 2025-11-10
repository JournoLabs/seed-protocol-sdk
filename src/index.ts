import SeedImage from './browser/react/SeedImage'
import { enableMapSet } from 'immer'

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
} from './schema'

export { BaseItem as Item } from './Item/BaseItem'
export { BaseItemProperty as ItemProperty } from './ItemProperty/BaseItemProperty'

export {
  useItems,
  useItem,
  useItemProperties,
  useCreateItem,
  useItemProperty,
  useDeleteItem,
  useGlobalServiceStatus,
  usePublishItem,
  usePersistedSnapshots,
  useServices,
  useService,
  useModels,
} from './browser/react'


export { SeedImage }

export {FileManager as FileManagerBrowser} from './browser/helpers/FileManager'
export {Db as DbBrowser} from './browser/db/Db'

export {models, versions, seeds, metadata, appState, config, modelUids, } from './seedSchema'

export {getModels, getModel, getModelNames,} from './stores/modelClass'

export { getCorrectId, } from './helpers'

export {
  eventEmitter,
} from './eventBus'

enableMapSet()

export { withSeed } from './node/webpack'

export type { PublishUpload } from './db/read/getPublishUploads'

// PathResolver - Platform-specific implementation
// Auto-initializes based on environment when imported
export { BasePathResolver as PathResolver } from './helpers/PathResolver/BasePathResolver'

// Initialize PathResolver based on environment
// This ensures the platform class is set when the SDK is imported
if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js - import node PathResolver to set platform class
  import('./node/helpers/PathResolver').catch(() => {
    // Silently fail if node PathResolver can't be loaded (e.g., in browser builds)
  })
} else {
  // Browser - import browser PathResolver to set platform class
  import('./browser/helpers/PathResolver').catch(() => {
    // Silently fail if browser PathResolver can't be loaded
  })
}

export { client } from './client'

export * from './types'

// Node.js CLI exports (only available in Node.js environment)
export { getTsImport, commandExists, INIT_SCRIPT_SUCCESS_MESSAGE, SCHEMA_TS } from './node'
export { createDrizzleSchemaFilesFromConfig, generateModelCode } from './node/codegen/drizzle'

