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
export { ItemProperty, ItemPropertySaveValidationError } from '../ItemProperty/ItemProperty'
export type { IItem, IItemProperty } from '../interfaces'

// Errors
export { AmbiguousModelError } from '../Model/errors'
export { ConflictError, type ConflictResult } from '../Schema/errors'
export { OwnershipError, assertItemOwned, isItemOwned } from '../helpers/ownership'

// Node.js specific exports
export { FileManager } from './helpers/FileManager'
export { Db, resolveSdkDrizzleMigrationsDir } from './db/Db'

// Schema exports
export { models, versions, seeds, metadata, appState, config, modelUids } from '../seedSchema'

// Model access - use Model static methods instead
// Models are accessible via Model.all(), Model.getById(), Model.getByName(), etc.

// Helper exports
export { getCorrectId } from '../helpers'
export {
  isPublishedSeedRef,
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '../helpers/relationSeedRef'

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
export type { MultiTabMode } from '../helpers/tabCoordinator'
export type { SyncFromEasOptions } from '../events/item/syncDbWithEas'
export type { HtmlEmbeddedDataUriPolicy } from '../helpers/property'

// CLI exports
export { PathResolver } from './helpers/PathResolver'
export { BasePathResolver } from '../helpers/PathResolver/BasePathResolver'
export {
  commandExists,
  ensureNodeDbSchema,
  runSeedInit,
  findSeedBinary,
} from './helpers/scripts'
export { INIT_SCRIPT_SUCCESS_MESSAGE, SCHEMA_TS } from '../helpers/constants'

// Side effect imports for CLI — register platform services
import { createPlatformServices } from '../platform/index.node'
import { configurePlatform } from '../platform/configurePlatform'
configurePlatform(createPlatformServices())

enableMapSet() 