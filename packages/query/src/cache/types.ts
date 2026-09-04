import type {
  ChangelogInclude,
  GetSeedOptions,
  GetSeedResult,
  SeedRecord,
} from '../types.js'

/**
 * Cached collection working set for a schema (skip=0 page).
 */
export type CachedCollectionData = {
  items: SeedRecord[]
  lastProcessedTimestamp: number
  lastProcessedItemId: string
  lastUpdated: number
  etag: string
}

/**
 * Cached single-seed assembly result (may include changelog).
 */
export type CachedItemData = {
  record: GetSeedResult
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
}

export type QueryCacheStats = {
  hits: number
  misses: number
  refreshes: number
  errors: number
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
