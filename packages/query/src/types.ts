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
}

export type QueryBySchemaOptions = AssembleOptions & {
  limit?: number
  skip?: number
}

export type QueryBySchemaResult = {
  items: SeedRecord[]
  limit: number
  skip: number
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
