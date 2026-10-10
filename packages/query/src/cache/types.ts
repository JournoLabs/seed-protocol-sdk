import type {
  ChangelogInclude,
  GetSeedOptions,
  GetSeedResult,
  SeedRecord,
} from '../types.js'
import type { SeedDependencies } from '../assembleSeeds.js'

/**
 * How a cached entry is kept current: changes (see QueryDataSource.listChangesSince) after
 * `checkedAt` have not been looked at yet. Each check's window overlaps the previous one, so a
 * change already applied can be seen again; `seenChangeKeys` lists those to skip.
 */
export type ChangeCheck = {
  /** Unix seconds. */
  checkedAt: number
  seenChangeKeys: string[]
}

/** Per-record bookkeeping in a cached collection. */
export type CachedRecordMeta = {
  dependencies: SeedDependencies
  /** Unix seconds when the record was assembled. */
  builtAt: number
}

/**
 * Cached collection working set for a schema and assemble options (skip=0 page).
 */
export type CachedCollectionData = ChangeCheck & {
  items: SeedRecord[]
  /** By seedUid. */
  meta: Record<string, CachedRecordMeta>
  /** Unix seconds of the last full assembly; the TTL counts from here. */
  lastUpdated: number
  etag: string
}

/**
 * Cached single-seed assembly result (may include changelog).
 */
export type CachedItemData = ChangeCheck & {
  record: GetSeedResult
  dependencies: SeedDependencies
  /** Unix seconds when the record was assembled; the TTL counts from here. */
  lastUpdated: number
  etag: string
  /** Fingerprint of assemble options used when caching. */
  optionsKey: string
}

export type QueryCacheConfig = {
  ttl: number
  cacheDir: string
  enabled: boolean
  backgroundRefresh: boolean
  refreshInterval: number
  /**
   * Deep-freeze records as they enter the memory cache (set, or loaded from the persistent layer).
   * Default: on unless NODE_ENV=production.
   */
  freezeRecords?: boolean
}

export type QueryCacheStats = {
  hits: number
  misses: number
  refreshes: number
  errors: number
}

/** Optional disk (or other) layer under CacheManager. Browser graphs omit this. */
export type PersistentCache = {
  getCollection(schemaName: string, optionsKey: string): Promise<CachedCollectionData | null>
  setCollection(schemaName: string, optionsKey: string, data: CachedCollectionData): Promise<void>
  getItem(seedUid: string, optionsKey: string): Promise<CachedItemData | null>
  setItem(data: CachedItemData): Promise<void>
  clearItem(seedUid: string, optionsKey: string): Promise<void>
  /** Every options variant of the schema's collection. */
  clearCollection(schemaName: string): Promise<void>
  clearAll(): Promise<void>
}

function includeCode(include?: ChangelogInclude): string {
  if (!include || include === 'data') return ''
  if (include === 'data+changelog') return 'i1'
  return 'i2' // changelog
}

/**
 * Build a stable key for assemble options that affect cached payloads.
 * Default latest-only (`include: 'data'`) keeps Phase 2 key `e1-h1`.
 */
export function buildAssembleOptionsKey(options?: {
  expandRelations?: boolean
  hydrateStorage?: boolean
  include?: ChangelogInclude
  changelog?: GetSeedOptions['changelog']
}): string {
  const expand = options?.expandRelations !== false
  const hydrate = options?.hydrateStorage !== false
  const base = `e${expand ? 1 : 0}-h${hydrate ? 1 : 0}`

  const inc = includeCode(options?.include)
  if (!inc) return base

  const gran = options?.changelog?.granularity === 'property' ? 'gp' : 'gv'
  const since =
    typeof options?.changelog?.since === 'number'
      ? `s${options.changelog.since}`
      : 's0'
  const limit =
    typeof options?.changelog?.limit === 'number'
      ? `l${options.changelog.limit}`
      : 'l0'
  return `${base}-${inc}-${gran}-${since}-${limit}`
}

/**
 * Sanitize seedUid for use as a filename segment.
 */
export function sanitizeSeedUidForPath(seedUid: string): string {
  return seedUid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
}
