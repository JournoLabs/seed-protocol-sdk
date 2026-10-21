import { enableMapSet } from 'immer'

// Core schema exports
export { Model, Property } from '../Schema'

// Core classes
export { Item } from '../Item/Item'
export { ItemProperty, ItemPropertySaveValidationError } from '../ItemProperty/ItemProperty'
export type { IItem, IItemProperty } from '../interfaces'

// Errors
export { AmbiguousModelError } from '../Model/errors'
export { ItemCreateValidationError, UnknownModelError, type ItemCreateProblem } from '../Item/errors'
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
export { isPublishedSeedRef } from '../helpers/relationSeedRef'
export { normalizeRelationPropertyValue, resolveSeedIdsFromRefString } from '@seedprotocol/arweave'

// Import exports
export * from '../imports'

// Event bus
export { eventEmitter } from '../eventBus'

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

// Register the Node platform services
import { createPlatformServices } from '../platform/index.node'
import { configurePlatform } from '../platform/configurePlatform'
configurePlatform(createPlatformServices())

enableMapSet() 