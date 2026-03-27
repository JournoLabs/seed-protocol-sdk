export {
  ModelPropertyDataTypes,
} from './Schema'

// Internal exports for @seedprotocol/react
export { eventEmitter } from './eventBus'
export { getClient } from './client/ClientManager'
export { ClientManagerState, MachineIds } from './client/constants'
export { BaseDb } from './db/Db/BaseDb'
export { createNewItem } from './db/write/createNewItem'
export { updateVersionUid } from './db/write/updateVersionUid'
export { getVersionData } from './db/read/subqueries/versionData'
export { getMetadataLatest } from './db/read/subqueries/metadataLatest'
export { loadAllSchemasFromDb } from './helpers/schema'
export { schemaMachine } from './Schema/service/schemaMachine'
export { propertyMachine } from './ItemProperty/service/propertyMachine'
export { SEED_PROTOCOL_SCHEMA_NAME, ImageSize } from './helpers/constants'
export { BaseFileManager } from './helpers'
export {
  seeds,
  metadata,
  versions,
  propertyUids,
  modelUids,
  appState,
  schemas,
  models,
  modelSchemas,
  properties,
  publishProcesses,
  uploadProcesses,
} from './seedSchema'
export type { SchemaType } from './seedSchema/SchemaSchema'
export type { SeedType } from './seedSchema/SeedSchema'
export type { IItem, IItemProperty } from './interfaces'
export type { ModelValues } from './types/model'

export { Item } from './Item/Item'
export { ItemProperty } from './ItemProperty/ItemProperty'
export { ModelProperty } from './ModelProperty/ModelProperty'
export { Schema } from './Schema/Schema'
// Note: SchemaAllOptions type is available from './Schema/Schema'
// Type-only exports cause issues with Rollup's parser. Import directly if needed:
// import type { SchemaAllOptions } from '@seedprotocol/sdk/Schema/Schema'
export { Model } from './Model/Model'

export { BaseFileManager as FileManager } from './helpers'
export { BaseEasClient as EasClient } from './helpers'
export { getEasSchemaForItemProperty } from './helpers/getSchemaForItemProperty'
export { setSchemaUidForSchemaDefinition, setSchemaUidForModel } from './stores/eas'

export {
  getModelSchemasFromEas, 
  getItemVersionsFromEas, 
  getItemPropertiesFromEas, 
  getEasSchemaUidBySchemaName,
  getSeedsFromSchemaUids,
  getSeedsBySchemaName,
} from './eas'

export { getCorrectId, generateId, withExcludeRevokedFilter } from './helpers'
export { isItemOwned } from './helpers/ownership'

export { SeedModels, INTERNAL_DATA_TYPES, VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA, DEFAULT_ARWEAVE_HOST, DEFAULT_ARWEAVE_GATEWAYS } from './helpers/constants'
export { getVersionsForSeedUid } from './db/read/getVersionsForSeedUid'
export { getMetadataAttestationUidsForSeedUid } from './db/read/getMetadataAttestationUidsForSeedUid'
export { getAttesterForSeed } from './db/read/getAttesterForSeed'
export { updateSeedRevokedAt } from './db/write/updateSeedRevokedAt'

export { getSegmentedItemProperties } from './helpers/getSegmentedItemProperties'
export { getAddressesForItemsFilter } from './helpers/db'

export {
  BaseArweaveClient,
  getArweaveUrlForTransaction,
  normalizeUploadApiBaseUrl,
  getUploadApiArweaveDataUrl,
  getUploadPipelineTransactionStatus,
} from './helpers'
export { waitForEntityIdle } from './helpers/waitForEntityIdle'
export {
  setUploadExecutor,
  getUploadExecutor,
  setGetPublisherForNewSeeds,
  getGetPublisherForNewSeeds,
  setRevokeExecutor,
  getRevokeExecutor,
  setAdditionalSyncAddresses,
  getGetAdditionalSyncAddresses,
} from './helpers/publishConfig'
export type { GetPublisherForNewSeeds, UploadExecutor, RevokeExecutor, GetAdditionalSyncAddresses } from './helpers/publishConfig'

export { 
  createSchema, 
  readSchema, 
  listCompleteSchemaFiles as listSchemas,
  getSchemaNameFromId,
} from './helpers/schema'

export { getPropertySchema } from './helpers/property'

export {
  resolvePublishPayloadValues,
  validateItemForPublish,
  PublishValidationFailedError,
  type ResolvedSeedUids,
  type PublishValidationError,
  type ValidateItemForPublishResult,
} from './db/read/getPublishPayload'

export { getRelatedItemsForPublish } from './db/read/getRelatedItemsForPublish'
export { itemHasPublishUploadCandidates } from './db/read/getPublishUploads'

export {
  updateModelProperties,
  renameModelProperty,
  deletePropertyFromModel,
  deleteModelFromSchema,
} from './helpers/updateSchema'
// Types - Type-only exports cause issues with Rollup's parser
// SchemaPropertyUpdate and SchemaModelUpdate types are available from './helpers/updateSchema'
// Import directly if needed: import type { SchemaPropertyUpdate, SchemaModelUpdate } from '@seedprotocol/sdk/helpers/updateSchema'

export {
  importJsonSchema,
  readJsonImportFile,
  syncSchemaFromSource,
  transformImportToSchemaFile,
} from './imports'
export type { SchemaFileFormat } from './imports'


export { client } from './client'
export type { SyncFromEasOptions } from './events/item/syncDbWithEas'

export * from './types'
export type { PublishUpload } from './types/publish'
