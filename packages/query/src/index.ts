export {
  initializeQueryPlatform,
  teardownQueryPlatform,
  isQueryPlatformInitialized,
  DEFAULT_ARWEAVE_HOST,
} from './bootstrap.js'
export type { InitializeQueryPlatformOptions } from './bootstrap.js'

export { assembleSeeds } from './assembleSeeds.js'
export { assembleSeedChangelog } from './assembleChangelog.js'
export { getSeed, queryBySchema, queryBySchemaForMonth } from './api.js'

export {
  buildFlatSnapshotFromProperties,
  diffVersionSnapshots,
  diffPropertyAttestations,
  applyChangelogFilters,
  decodePropertyAttestation,
  changelogValuesEqual,
} from './changelog.js'

export type {
  SeedRecord,
  AssembleOptions,
  GetSeedOptions,
  GetSeedResult,
  ChangelogInclude,
  ChangelogOptions,
  ChangelogEntry,
  VersionChangelogEntry,
  PropertyChangelogEntry,
  QueryBySchemaOptions,
  QueryBySchemaResult,
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
  QueryCacheConfig,
  QueryCacheStats,
} from './cache/index.js'

export { getArweaveUrlForTransaction } from './arweaveUrl.js'

export {
  publicListRelationPropertyKey,
  stripListRelationStorageAliasesForPublicKey,
  tryCoerceJsonStringArray,
} from './listRelationKey.js'

export {
  parseEasPropertyMetadata,
  parseEasPropertyMetadataForFeed,
} from './parseEasPropertyMetadata.js'
export type {
  EasPropertyMetadata,
  EasPropertyMetadataForFeed,
  ParseEasPropertyMetadataResult,
  ParseEasPropertyMetadataForFeedResult,
} from './parseEasPropertyMetadata.js'

export {
  RICH_BODY_STORAGE_SCHEMAS,
  FEED_RICH_BODY_STORAGE_SCHEMAS,
  isRichBodyStorageSchema,
  isFeedRichBodyStorageSchema,
  richBodyModelPriority,
  feedRichBodyModelPriority,
  getFieldStorageModels,
  getFeedFieldStorageModels,
  getListElementStorageModels,
  getFeedListElementStorageModels,
  setFieldStorageModel,
  setFeedFieldStorageModel,
  setListElementStorageModels,
  setFeedListElementStorageModels,
} from './fieldStorageModel.js'
export type {
  FieldStorageModels,
  FeedFieldStorageModels,
  ListElementStorageModels,
  FeedListElementStorageModels,
} from './fieldStorageModel.js'

export {
  enrichImageSeedClone,
  enrichImageSeedCloneForFeed,
} from './imageRelationEnrichment.js'

export {
  hydrateArweaveRichTextInItems,
  hydrateArweaveRichTextInFeedItems,
  isArweaveTransactionGatewayUrl,
} from './hydrateArweaveRichText.js'
