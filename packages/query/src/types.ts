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
