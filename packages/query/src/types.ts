export type SeedRecord = {
  seedUid: string
  schemaName: string
  attester?: string
  timeCreated: number
  versionUid: string
  data: Record<string, unknown>
}

export type AssembleOptions = {
  /** Expand relation UIDs to nested objects when possible. Default true. */
  expandRelations?: boolean
  /** Fetch Arweave gateway bodies into html/body/content (and marked storage fields). Default true. */
  hydrateStorage?: boolean
  /**
   * Use collection/item cache when enabled via CACHE_* env.
   * Default: follow loadQueryCacheConfig().enabled.
   * Pass false to bypass cache for this call.
   */
  cache?: boolean
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

/** Options for `getSeed` (changelog is single-seed only). */
export type GetSeedOptions = AssembleOptions & {
  /** Default `'data'`. */
  include?: ChangelogInclude
  changelog?: ChangelogOptions
}

export type GetSeedResult = SeedRecord & {
  /** Present when include is `data+changelog` or `changelog`. */
  changelog?: ChangelogEntry[]
}

export type QueryBySchemaOptions = AssembleOptions & {
  limit?: number
  skip?: number
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
}
