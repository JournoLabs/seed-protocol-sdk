export {
  ModelPropertyDataTypes,
  isDataType,
  normalizeDataType,
} from './Schema'

// Internal exports for @seedprotocol/react
export { eventEmitter } from './eventBus'
export {
  ADDRESSES_PERSISTED_EVENT,
  LOCAL_COPIES_REMOVED_EVENT,
  parseAddressesPersistedPayload,
} from './client/events'
export type {
  AddressesPersistedPayload,
  LocalCopiesRemovedPayload,
} from './client/events'
export { getClient, INIT_CONFIG_CONFLICT_MESSAGE } from './client/ClientManager'
export { ClientManagerState, MachineIds } from './client/constants'
export { isClientReady, isClientReadySnapshot, whenDbReady } from './client/readiness'
export { BaseDb } from './db/Db/BaseDb'
export { isChangeFeedRunning, watchEntityChanges, watchEntityRows } from './browser/db/changeFeed'
export type { ChangeWatch, EntityChangeTable } from './browser/db/changeFeed'
export { createNewItem } from './db/write/createNewItem'
export { updateVersionUid } from './db/write/updateVersionUid'
export {
  applyPropertyAttestationUidsFromPublish,
} from './db/write/applyPropertyAttestationUidsFromPublish'
export type { PropertyAttestationApplyPair } from './db/write/applyPropertyAttestationUidsFromPublish'
export { getVersionData } from './db/read/subqueries/versionData'
export { getMetadataLatest } from './db/read/subqueries/metadataLatest'
export {
  compareMetadataRowsLatestFirst,
  pickLatestMetadataRowPerProperty,
  METADATA_LATEST_FIRST_ORDER_SQL,
} from './helpers/compareMetadataRowsLatestFirst'
export type { MetadataRecencyRow } from './helpers/compareMetadataRowsLatestFirst'
export type { PropertyConflict } from './outbox/conflicts'
export { loadAllSchemasFromDb } from './helpers/schema'
export { schemaMachine } from './Schema/service/schemaMachine'
export { propertyMachine } from './ItemProperty/service/propertyMachine'
export { SEED_PROTOCOL_SCHEMA_NAME, ImageSize } from './helpers/constants'
export { BaseFileManager } from './helpers'
export {
  seeds,
  metadata,
  versions,
  modelUids,
  appState,
  schemas,
  models,
  modelSchemas,
  properties,
  publishProcesses,
  uploadProcesses,
  arweaveL1FinalizeJobs,
  htmlEmbeddedImageCoPublish,
  easSyncProcesses,
} from './seedSchema'
export type { SchemaType } from './seedSchema/SchemaSchema'
export type { SeedType } from './seedSchema/SeedSchema'
export type { IItem, IItemProperty } from './interfaces'
export type { ModelValues } from './types/model'

export { Item } from './Item/Item'
export {
  ArchiveExportError,
  exportArchive,
  type ArchiveExportErrorCode,
  type ArchiveOmission,
  type ExportArchiveOptions,
  type ExportArchiveResult,
} from './archive/exportArchive'
export { ItemProperty, ItemPropertySaveValidationError, ClearNotSupportedError } from './ItemProperty/ItemProperty'
export { AmbiguousModelError } from './Model/errors'
export {
  ItemCreateError,
  ItemCreateValidationError,
  UnknownModelError,
  type ItemCreateErrorCode,
  type ItemCreateProblem,
} from './Item/errors'
export { ConflictError, type ConflictResult } from './Schema/errors'
export { EntityUnloadedError } from './helpers/entity/entityLifecycle'
export { OutboxOpFailedError } from './outbox/outbox'
export { RelationTargetError } from './outbox/itemAppliers'
export { StagedValueMissingError } from './storageValue/stage'
export type { ValidationError, ValidationResult } from './Schema/validation'
export { DatabaseNotPersistentError, FileSystemLockedError, UnsupportedBrowserError } from './helpers/FileManager/errors'
export { checkBrowserSupport, type BrowserFeature, type BrowserSupport } from './helpers/browserSupport'
export { isLeaderTab, whenLeaderTab, type MultiTabMode } from './helpers/tabCoordinator'
export { FILES_CHANGED_EVENT } from './helpers/tabEvents'
export { TabLockTimeoutError } from './helpers/tabLocks'
export {
  MODEL_AMBIGUOUS_EVENT,
  type ModelAmbiguousEventPayload,
} from './db/read/resolveModelForSyncedSeed'
export { ModelProperty } from './ModelProperty/ModelProperty'
export { Schema } from './Schema/Schema'
// Note: SchemaAllOptions type is available from './Schema/Schema'
// Type-only exports cause issues with Rollup's parser. Import directly if needed:
// import type { SchemaAllOptions } from '@seedprotocol/sdk/Schema/Schema'
export { Model } from './Model/Model'

export { BaseFileManager as FileManager } from './helpers'
export { BaseEasClient as EasClient } from '@seedprotocol/eas'
export {
  setSchemaUidForSchemaDefinition,
  setSchemaUidForModel,
  getEasSchemaUidForExactDefinition,
} from '@seedprotocol/eas'
export { listRelationEasPropertyName, easPropertyNameForPublish } from './helpers/metadataPropertyNames'

export { getModelSchemasFromEas } from './eas'
export {
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  getCanonicalItemPropertiesFromEas,
  getSeedsFromSchemaUids,
  getSeedsBySchemaName,
} from '@seedprotocol/eas'

export { getCorrectId, generateId } from './helpers'
export { isPublishedSeedRef } from './helpers/relationSeedRef'
export { normalizeRelationPropertyValue, resolveSeedIdsFromRefString } from '@seedprotocol/arweave'
export { withExcludeRevokedFilter } from '@seedprotocol/eas'
export {
  EAS_CHAIN_DEPLOYMENTS,
  getEasChainDeployment,
  getEasEndpoint,
  getEasReadChainId,
  type EasChainDeployment,
} from '@seedprotocol/eas'
export {
  assertLocalDbChain,
  EAS_CHAIN_ID_APP_STATE_KEY,
} from './helpers/localDbChain'
export { resolveMediaRef } from './helpers/mediaRef'
export {
  classifyMediaRef,
  normalizeFeedItemFields,
  getFeedItemStringField,
} from '@seedprotocol/arweave'
export type {
  FeedFieldRole,
  FeedFieldDescriptor,
  FeedFieldManifest,
  ClassifyMediaRefOptions,
  MediaRefClassification,
  ResolveMediaRefResult,
  ResolveMediaRefOptions,
  NormalizedMediaField,
  NormalizedHtmlField,
  NormalizedTextField,
  NormalizedFeedFieldValue,
} from '@seedprotocol/arweave'
export {
  ensureImageLocal,
  closestImageSize,
  normalizeArweaveTxIdForEnsure,
} from './helpers/ensureImageLocal'
export type {
  EnsureImageLocalParams,
  EnsureImageLocalResult,
} from './helpers/ensureImageLocal'
export {
  isEasAttestationExplorerUrl,
  resolveSeedRssImageRelationRef,
  resolveSeedRssImageRelationFromItem,
  SEED_RSS_IMAGE_RELATION_FIELD_KEYS,
} from '@seedprotocol/arweave'
export type { SeedRssImageRelationRef } from '@seedprotocol/arweave'
export {
  pickLatestPropertyAttestationsByRefAndSchema,
  easName,
  matchEasName,
  type NameMatchLevel,
  isPlaceholderUid,
  isValidEasAttestationUid,
  normalizeBytes32Hex,
} from '@seedprotocol/eas'
export type {
  AttestationLikeForCanonical,
  PickLatestPropertyAttestationsOptions,
} from '@seedprotocol/eas'
export {
  isItemOwned,
  assertItemOwned,
  OwnershipError,
  isLocalUnsealedDraft,
  publisherIsInOwnedSet,
  isSeedRowOwned,
  publisherInAddressListSql,
  ownedPublisherSql,
  ownedSeedsSql,
  localUnsealedDraftSql,
  placeholderUidSql,
} from './helpers/ownership'

export {
  SeedModels,
  INTERNAL_DATA_TYPES,
  VERSION_SCHEMA_UID,
  VERSION_SCHEMA_DEF,
  VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
  DEFAULT_ARWEAVE_HOST,
  DEFAULT_SEED_FEED_HYPER_KEY,
  DEFAULT_SEED_GATEWAY_HYPER_KEY,
  DEFAULT_GATEWAY_SIDECAR_HOST,
  DEFAULT_GATEWAY_SIDECAR_PORT,
  DEFAULT_ARWEAVE_GATEWAYS,
  DEFAULT_ARWEAVE_GRAPHQL_URL,
  getDefaultArweaveReadGatewayHostsOrdered,
  mergePrimaryHostWithDefaults,
  isKnownArweaveGatewayHostname,
  EAS_SEED_DATA_SYNCED_TO_DB_EVENT,
} from './helpers/constants'
export { getVersionsForSeedUid } from './db/read/getVersionsForSeedUid'
export {
  getPublishPendingDiff,
} from './db/read/getPublishPendingDiff'
export type {
  PublishPendingPropertyDiff,
  GetPublishPendingDiffResult,
} from './db/read/getPublishPendingDiff'
export { getSeedPublishState } from './db/read/getSeedPublishState'
export type { SeedPublishState } from './db/read/getSeedPublishState'
export {
  createLocalQueryDataSource,
  registerSeedQueryLocalSource,
  unregisterSeedQueryLocalSource,
  isSeedQueryLocalSourceRegistered,
  getPublishedSeedRecord,
} from './query'
export type { GetPublishedSeedRecordOptions } from './query'
export type { PublishMode, GetPublishPayloadOptions } from './db/read/getPublishPayload'
export { getMetadataAttestationUidsForSeedUid } from './db/read/getMetadataAttestationUidsForSeedUid'
export { getAttesterForSeed } from './db/read/getAttesterForSeed'
export { updateSeedRevokedAt } from './db/write/updateSeedRevokedAt'
export { markPropertyAttestationsRetracted } from './db/write/markPropertyAttestationsRetracted'
export { getPendingRetractions, type PendingRetraction } from './db/read/getPropertyClear'

export { getAddressesForItemsFilter } from './helpers/db'
export { claimUnpublishedDrafts } from './db/write/claimUnpublishedDrafts'
export {
  normalizeHexAddress,
  normalizeAddressList,
  normalizePublisher,
  normalizeAddressConfig,
} from './helpers/addresses'

export { getArweaveUrlForTransaction } from '@seedprotocol/arweave'
export {
  BaseArweaveClient,
  normalizeUploadApiBaseUrl,
  getUploadApiArweaveDataUrl,
  getUploadPipelineTransactionStatus,
  getUploadApiArweaveStatusUrl,
  getArweaveUploadStatus,
  isArweaveL1AnchoringComplete,
  queryArweaveGatewayTransaction,
  queryArweaveGatewayTransactionWithFallback,
  ensureReadGatewaySelected,
  invalidateReadGatewayCache,
  resetArweaveReadGatewayForTests,
  isReadGatewayKnownHealthy,
  getLastHealthyReadGatewayHost,
  isGatewayHostCircuitOpen,
  recordGatewayHostSuccess,
  recordGatewayHostFailure,
  normalizeGatewayHostKey,
  resolveSeedGatewayEndpoints,
  invalidateSidecarProbeCache,
  getReadGatewayHostsForConfig,
  seedGatewayConfigFromSeedConfig,
  seedGatewayConfigFromClientContext,
  getResolvedSeedGatewayEndpoints,
  setResolvedSeedGatewayEndpoints,
  getPreferredArweaveReadBaseUrls,
  setPreferredArweaveReadBaseUrls,
  getArweaveReadBaseUrls,
  getResolvedArweaveReadBaseUrls,
  fetchArweaveRawFromBaseUrl,
  fetchArweaveRawTextAcrossGateways,
  setArweaveContentReadTransform,
  hasArweaveContentReadTransform,
  transformArweaveContent,
  readArweaveContentResponse,
  rehostArweaveLinksInHtml,
  nextArweaveGatewayUrl,
  mapUrlAttribute,
  parseArweaveTransactionLink,
} from '@seedprotocol/arweave'
export type {
  ArweaveTransactionLink,
  HtmlArweaveRefs,
} from '@seedprotocol/arweave'
export type {
  SeedGatewayTransportMode,
  SeedGatewayActivePath,
  SeedGatewayHyperConfig,
  SeedGatewayConfig,
  ResolvedSeedGatewayEndpoints,
} from '@seedprotocol/arweave'
export type {
  ResolveSeedGatewayEndpointsOptions,
  ArweaveUploadStatusResponse,
  ArweaveGatewayTransactionQueryResult,
  ArweaveReadBaseUrlOptions,
  ArweaveContent,
  ArweaveContentReadContext,
  ArweaveContentReadTransform,
} from '@seedprotocol/arweave'
export {
  setPublishExecutor,
  getPublishExecutor,
  PUBLISH_NOT_CONFIGURED_MESSAGE,
  setUploadExecutor,
  getUploadExecutor,
  setGetPublisherForNewSeeds,
  getGetPublisherForNewSeeds,
  setRevokeExecutor,
  getRevokeExecutor,
  setAdditionalSyncAddresses,
  getGetAdditionalSyncAddresses,
} from './helpers/publishConfig'
export type {
  GetPublisherForNewSeeds,
  ItemPublishOptions,
  PublishExecutor,
  UploadExecutor,
  RevokeExecutor,
  GetAdditionalSyncAddresses,
} from './helpers/publishConfig'

export {
  listCompleteSchemaFiles as listSchemas,
  getSchemaNameFromId,
} from './helpers/schema'

export { getPropertySchema } from './helpers/property'
export type { HtmlEmbeddedDataUriPolicy } from './helpers/property'

export {
  resolvePublishPayloadValues,
  validateItemForPublish,
  PublishValidationFailedError,
  type ResolvedSeedUids,
  type PublishValidationError,
  type ValidateItemForPublishResult,
} from './db/read/getPublishPayload'
export {
  RelatedItemUnpublishedError,
  RELATED_ITEM_UNPUBLISHED_CODE,
  type UnpublishedRelatedItem,
} from './db/read/publishErrors'

export {
  getPublishGraph,
  type PublishGraph,
  type PublishGraphNode,
  type PublishGraphProperty,
  type PublishGraphRef,
  type PublishPropertyKind,
  type GetPublishGraphOptions,
} from './db/read/publishGraph'
export {
  itemHasPublishUploadCandidates,
  getPublishUploadData,
  type GetPublishUploadsOptions,
} from './db/read/getPublishUploads'
export type { PublishUploadData } from './types/publish'
export {
  CONTENT_SHA256_TAG,
  CONTENT_TYPE_TAG,
  getContentSha256,
  contentSha256TagMatches,
  buildArweaveContentTags,
} from './helpers/arweaveContentTags'
export {
  summarizePublishWork,
  getUnpublishedRelatedItems,
  estimateDataUriByteLength,
  type PublishWorkSummary,
  type SummarizePublishWorkOptions,
} from './db/read/summarizePublishWork'

export {
  prepareHtmlEmbeddedImagesForPublish,
  rewriteHtmlEmbeddedImagesOnDisk,
  clearHtmlEmbeddedImageCoPublishRows,
  resolveEffectiveHtmlEmbeddedDataUriPolicy,
  extractDataUriImagesFromHtml,
  replaceDataUrisInParsedHtml,
  HtmlEmbeddedDataUriLimitError,
  findSeedPropertyRefsInHtml,
  replaceSeedPropertyRefsInHtml,
  HtmlSeedPropertyRefError,
  SEED_PROPERTY_REF_PREFIX,
  HTML_EMBEDDED_MAX_IMAGES_PER_DOC,
  HTML_EMBEDDED_MAX_IMAGE_BYTES,
  HTML_EMBEDDED_MAX_TOTAL_BYTES,
} from './helpers/htmlEmbeddedDataUriPublish'
export type {
  HtmlEmbeddedExtractEntry,
  PrepareHtmlEmbeddedImagesResult,
  UploadedTx as HtmlEmbeddedUploadedTx,
} from './helpers/htmlEmbeddedDataUriPublish'

export {
  updateModelProperties,
  renameModelProperty,
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
export type { SchemaFileFormat, SchemaFileInput, SchemaNameMatch } from './imports'


export { client } from './client'
export type { SyncFromEasOptions } from './events/item/syncDbWithEas'
export type { EasSyncProcessType } from './seedSchema/EasSyncProcessSchema'
/** Turn off (or back on) retrying the startup EAS lookup and failed syncs when back online. */
export { setRetriesWhenOnlineEnabled } from './helpers/retryWhenOnline'
export {
  easSyncActor,
  startEasSyncActor,
  sendEasSyncClientRequest,
  requestEasSyncFromAddressChange,
  requestEasSyncFromModelsInit,
} from './events/item/easSyncManager'
export type {
  EasSyncMachineContext,
  EasSyncRequestEvent,
} from './events/item/easSyncManager'
export { mergeEasSyncRequestIntents } from './events/item/mergeEasSyncOptions'

export * from './types'
export type { PublishUpload } from './types/publish'
