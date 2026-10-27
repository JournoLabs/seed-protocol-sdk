import { enableMapSet } from 'immer'

// Core schema exports
export { Model, Property } from '../Schema'

// Core classes
export { Item } from '../Item/Item'
export { ItemProperty, ItemPropertySaveValidationError, ClearNotSupportedError } from '../ItemProperty/ItemProperty'
export type { IItem, IItemProperty } from '../interfaces'

// Errors. Every error class the main entry exports that Node code can throw is exported here too
// (__tests__/node/nodeEntryErrors.test.ts checks).
export { AmbiguousModelError } from '../Model/errors'
export {
  ItemCreateError,
  ItemCreateValidationError,
  UnknownModelError,
  type ItemCreateErrorCode,
  type ItemCreateProblem,
} from '../Item/errors'
export { ConflictError, type ConflictResult } from '../Schema/errors'
export { OwnershipError, assertItemOwned, isItemOwned } from '../helpers/ownership'
export { EntityUnloadedError } from '../helpers/entity/entityLifecycle'
export { TabLockTimeoutError } from '../helpers/tabLocks'
export { OutboxOpFailedError, OutboxSaveTimeoutError } from '../outbox/outbox'
export { RelationTargetError } from '../outbox/itemAppliers'
export { StagedValueMissingError } from '../storageValue/stage'
export { PublishValidationFailedError, type PublishValidationError } from '../db/read/getPublishPayload'
export { RelatedItemUnpublishedError, RELATED_ITEM_UNPUBLISHED_CODE } from '../db/read/publishErrors'
export { HtmlEmbeddedDataUriLimitError, HtmlSeedPropertyRefError } from '../helpers/htmlEmbeddedDataUriPublish'

// Archive export
export {
  ArchiveExportError,
  exportArchive,
  type ArchiveExportErrorCode,
  type ArchiveOmission,
  type ExportArchiveOptions,
  type ExportArchiveResult,
} from '../archive/exportArchive'

// Node.js specific exports
export { NodeFileManager } from './helpers/FileManager'
export { NodeDb, resolveSdkDrizzleMigrationsDir } from './db/Db'

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