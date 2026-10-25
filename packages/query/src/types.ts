/**
 * A seed's assembled properties. Read-only: records returned by `getSeed` / `queryBySchema` /
 * `queryBySchemaForMonth` may be the query cache's own objects, shared with every later caller
 * (and deep-frozen outside production). Copy before changing anything, including nested values.
 * Still assignable to a `Record<string, unknown>` parameter.
 */
export type SeedData = { readonly [key: string]: unknown }

export type SeedRecord = {
  readonly seedUid: string
  readonly schemaName: string
  readonly attester?: string
  readonly timeCreated: number
  readonly versionUid: string
  readonly data: SeedData
}

/** Where to load Seed/Version/property attestations from. Default `'remote'`. */
export type QuerySourceMode = 'local' | 'remote' | 'auto'

/**
 * How relation properties are returned. `'expand'`: Html/File relations become Arweave URLs and
 * other related seeds nested objects. `'urls'`: storage relations become URLs, the rest stay seed
 * UIDs. `'uids'`: every relation stays a seed UID under its stored key, and related seeds aren't
 * fetched at all (no related seed, version or property requests).
 */
export type RelationsMode = 'expand' | 'urls' | 'uids'

export type AssembleOptions = {
  /** Default `'expand'`. */
  relations?: RelationsMode
  /** Fetch Arweave gateway bodies into html/body/content (and marked storage fields). Default true. */
  hydrateStorage?: boolean
  /**
   * Use collection/item cache when enabled via CACHE_* env.
   * Default: follow loadQueryCacheConfig().enabled.
   * Pass false to bypass cache for this call.
   * Only applies when the resolved source is `'remote'`.
   */
  cache?: boolean
  /**
   * Data backend: remote EAS, registered local SQLite adapter, or auto (local then remote).
   * Default `'remote'`.
   */
  source?: QuerySourceMode
}

/** The relations mode `options` ask for. */
export function relationsModeOf(options?: { relations?: RelationsMode }): RelationsMode {
  return options?.relations ?? 'expand'
}

export type ChangelogInclude = 'data' | 'data+changelog' | 'changelog'

export type ChangelogOptions = {
  /** Snapshot diffs vs per-attestation events. Default `'version'`. */
  granularity?: 'version' | 'property'
  /** Inclusive lower bound on entry `at` (unix seconds). */
  since?: number
  /** Max entries after filtering (newest-first). */
  limit?: number
}

export type VersionChangelogEntry = {
  type: 'version'
  at: number
  versionUid: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  changedKeys: string[]
}

export type PropertyChangelogEntry = {
  type: 'property'
  at: number
  versionUid: string
  property: string
  attestationUid: string
  previousValue: unknown
  nextValue: unknown
}

export type ChangelogEntry = VersionChangelogEntry | PropertyChangelogEntry

/**
 * Which state of a seed to assemble instead of its latest. `versionUid` names one of the seed's
 * versions; `asOf` (unix seconds) leaves out attestations made after it: versions created later,
 * and property attestations made later (a `patch` publish adds them to the current version).
 * With `asOf` alone, the seed's newest version created by then. Related seeds are still
 * assembled at their latest version.
 */
export type VersionPin = {
  versionUid?: string
  asOf?: number
}

/** Options for `getSeed` (changelog is single-seed only). */
export type GetSeedOptions = AssembleOptions & VersionPin & {
  /** Default `'data'`. */
  include?: ChangelogInclude
  changelog?: ChangelogOptions
}

/** Options for `getSeeds`: the assemble options, plus versions to read for some of the seeds. */
export type GetSeedsOptions = AssembleOptions & {
  /** By seed UID (any case). A seed without its pinned version is left out of the result. */
  pins?: ReadonlyMap<string, VersionPin>
}

export type GetSeedResult = SeedRecord & {
  /** Present when include is `data+changelog` or `changelog`. */
  readonly changelog?: readonly ChangelogEntry[]
}

export type QueryBySchemaOptions = AssembleOptions & {
  limit?: number
  skip?: number
  /**
   * Only seeds whose UID starts with this: at least 4 hex digits, with or without `0x`, any case.
   * Reads don't use the collection cache (the result isn't the schema's working set); the item
   * cache is written through as usual. An invalid prefix returns no items.
   */
  uidPrefix?: string
  /**
   * Only seeds whose Seed attestation was made by one of these addresses (`SeedRecord.attester`),
   * in any case. Applied before `limit` and `skip`: in the EAS request on the remote source.
   * Entries that aren't 20-byte hex addresses are ignored; if none is left, or the list is empty,
   * no items. Combines with `uidPrefix`. Like `uidPrefix`, reads don't use the collection cache.
   */
  attesters?: readonly string[]
  /**
   * Seconds after this collection was last checked against the indexer during which it is
   * returned from the collection cache with no request at all. New, changed and revoked seeds
   * show up to this many seconds late. Applies only where the collection cache does (remote,
   * `skip` 0, no `uidPrefix` or `attesters`, cache enabled). Default: `CACHE_MAX_AGE`, else 0 (check every read).
   */
  maxAge?: number
}

export type QueryBySchemaResult = {
  items: SeedRecord[]
  limit: number
  skip: number
  /** Present when collection cache was consulted or updated (skip === 0). */
  etag?: string
}

export type AttestationLike = {
  id: string
  decodedDataJson: string
  refUID: string
  schemaId: string
  timeCreated: number
  attester?: string
  schema?: { schemaNames?: Array<{ name: string }> }
  /** Whether the attestation is revoked (EAS `revoked`; the local source sets it from `revoked_at`). */
  revoked?: boolean
}

/** An attestation created or revoked after some time (see QueryDataSource.listChangesSince). */
export type AttestationChange = {
  id: string
  refUID: string
  timeCreated: number
  /** Unix seconds; 0 when not revoked. */
  revocationTime: number
}
