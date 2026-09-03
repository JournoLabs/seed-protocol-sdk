import type { SeedRecord } from '../types.js'

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
 * Cached single-seed assembly result.
 */
export type CachedItemData = {
  record: SeedRecord
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

/**
 * Build a stable key for assemble options that affect cached payloads.
 */
export function buildAssembleOptionsKey(options?: {
  expandRelations?: boolean
  hydrateStorage?: boolean
}): string {
  const expand = options?.expandRelations !== false
  const hydrate = options?.hydrateStorage !== false
  return `e${expand ? 1 : 0}-h${hydrate ? 1 : 0}`
}

/**
 * Sanitize seedUid for use as a filename segment.
 */
export function sanitizeSeedUidForPath(seedUid: string): string {
  return seedUid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
}
