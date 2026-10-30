export {
  initializeQueryPlatform,
  teardownQueryPlatform,
  isQueryPlatformInitialized,
  DEFAULT_ARWEAVE_HOST,
} from './bootstrap.js'
export type { InitializeQueryPlatformOptions } from './bootstrap.js'

export { assembleSeeds } from './assembleSeeds.js'
export { assembleSeedChangelog } from './assembleChangelog.js'
export {
  getSeed,
  getSeeds,
  getSeedAttestations,
  normalizeUidPrefix,
  normalizeAttesters,
  queryBySchema,
  queryBySchemaForMonth,
} from './api.js'

export {
  registerLocalQuerySource,
  clearLocalQuerySource,
  getRegisteredLocalQuerySource,
  hasLocalQuerySource,
  createRemoteQueryDataSource,
  getRemoteQueryDataSource,
  resolveQuerySource,
  normalizeSourceMode,
} from './source/index.js'
export type { QueryDataSource, ResolvedQuerySource, SeedListFilter } from './source/index.js'
export type { SeedAttestations, SeedPropertyAttestation } from './seedAttestations.js'

export {
  buildFlatSnapshotFromProperties,
  diffVersionSnapshots,
  diffPropertyAttestations,
  applyChangelogFilters,
  decodePropertyAttestation,
  changelogValuesEqual,
} from './changelog.js'

export type {
  SeedData,
  SeedRecord,
  AssembleOptions,
  RelationsMode,
  QuerySourceMode,
  GetSeedOptions,
  GetSeedResult,
  GetSeedsOptions,
  VersionPin,
  ChangelogInclude,
  ChangelogOptions,
  ChangelogEntry,
  VersionChangelogEntry,
  PropertyChangelogEntry,
  QueryBySchemaOptions,
  QueryBySchemaResult,
  AttestationChange,
  AttestationLike,
} from './types.js'

export {
  getQueryCacheManager,
  resetQueryCacheManager,
  createQueryCacheManager,
  loadQueryCacheConfig,
  CacheManager,
  buildAssembleOptionsKey,
} from './cache/index.js'
export type {
  CachedCollectionData,
  CachedItemData,
  PersistentCache,
  QueryCacheConfig,
  QueryCacheStats,
} from './cache/index.js'

export { getArweaveUrlForTransaction } from '@seedprotocol/arweave'

export {
  publicListRelationPropertyKey,
  stripListRelationStorageAliasesForPublicKey,
  tryCoerceJsonStringArray,
} from './listRelationKey.js'

export { setQueryModels } from './queryModels.js'
export type { QueryModels } from './queryModels.js'

export {
  parseEasPropertyMetadata,
} from './parseEasPropertyMetadata.js'
export type {
  EasPropertyMetadata,
  ParseEasPropertyMetadataResult,
} from './parseEasPropertyMetadata.js'

export { parseEasRelationPropertyName } from './parseEasRelationPropertyName.js'
export type { ParsedEasRelationPropertyName } from './parseEasRelationPropertyName.js'

export {
  RICH_BODY_STORAGE_SCHEMAS,
  isRichBodyStorageSchema,
  richBodyModelPriority,
  getFieldStorageModels,
  getListElementStorageModels,
  setFieldStorageModel,
  setListElementStorageModels,
} from './fieldStorageModel.js'
export type {
  FieldStorageModels,
  ListElementStorageModels,
} from './fieldStorageModel.js'

export {
  enrichImageSeedClone,
} from './imageRelationEnrichment.js'

export {
  hydrateArweaveRichTextInItems,
  isArweaveTransactionGatewayUrl,
  resetArweaveBodyCache,
} from './hydrateArweaveRichText.js'
export type { HydrateStorageOptions } from './hydrateArweaveRichText.js'
