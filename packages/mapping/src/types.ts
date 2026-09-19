/** Kind of a source field extracted from an external document. */
export type SourceKind =
  | 'frontmatter'
  | 'section'
  | 'full'
  | 'rssField'
  | 'xmlPath'
  | 'resolved'

/** Media class from pure URL / content-type classification (import-time). */
export type UrlMediaClass =
  | 'html'
  | 'image'
  | 'audio'
  | 'video'
  | 'unknown'

/** Host-resolved transform applied before coerce. */
export type ResolveJob = 'extract' | 'file' | 'lookup'

/** A mappable value from markdown, RSS, or XML. */
export type SourceNode = {
  id: string
  label: string
  kind: SourceKind
  value: string
  meta?: Record<string, unknown>
}

/** Target Seed model property. */
export type TargetProperty = {
  name: string
  dataType: string
  /** Related model name (e.g. Identity) for Relation / List-of-Relation. */
  ref?: string
  /** Element type for List properties (e.g. Relation, Text). */
  refValueType?: string
}

/**
 * Source → property edge.
 * A source may map to multiple properties; each property appears at most once.
 * When `resolve` is set, async apply transforms the value; sync apply skips the edge.
 */
export type FieldMapping = {
  sourceId: string
  propertyName: string
  resolve?: ResolveJob
}

/**
 * Per-property string → seed uid (or uid list) dictionary for `resolve: 'lookup'`.
 * Keys are trimmed source values.
 */
export type MappingLookups = Record<string, Record<string, string | string[]>>

/** Persistable mapping authored in the UI (or programmatically). */
export type MappingDocument = {
  version: 1
  sourceKind: 'markdown' | 'rss' | 'xml'
  mappings: FieldMapping[]
  /** Optional relation value maps keyed by property name. */
  lookups?: MappingLookups
}

/** Result of applying mappings: property name → coerced value. */
export type PropertyBag = Record<string, unknown>

/** Context passed to the host resolve callback. */
export type ResolveContext = {
  job: ResolveJob
  source: SourceNode
  target: TargetProperty
  /** Present for extract/file jobs. */
  url?: string
  contentType?: string
  class?: UrlMediaClass
  /** Present for lookup jobs — trimmed source string. */
  rawValue?: string
}

/** Host-provided resolver; package never fetches or loads Seed items. */
export type ResolveCallback = (ctx: ResolveContext) => Promise<unknown>

export type ApplyMappingError = {
  sourceId: string
  propertyName: string
  resolve?: ResolveJob
  message: string
}

export type ApplyMappingAsyncResult = {
  properties: PropertyBag
  errors: ApplyMappingError[]
}
