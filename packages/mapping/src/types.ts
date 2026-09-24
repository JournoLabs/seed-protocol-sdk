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
export type ResolveJob = 'extract' | 'file' | 'lookup' | 'derive' | 'assemble'

/** Write this property from another mapped property. Host owns apply. */
export type DeriveSpec = {
  /** Source property name (e.g. `title`). Package does not interpret it. */
  from: string
  /** When a mapped origin is empty, still derive. */
  fallback?: boolean
}

/** Include named blocks when assembling stored HTML. Host owns apply and names. */
export type AssembleSpec = {
  blocks: string[]
}

/** A mappable value from markdown, RSS, or XML. */
export type SourceNode = {
  id: string
  label: string
  /**
   * Optional secondary line (e.g. origin field name for a resolved well).
   * Prefer this over stuffing `· link` into `label`. Display-only — not
   * part of MappingDocument.
   */
  subtitle?: string
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
  /**
   * When true, FieldMapper coverage treats an empty mapping as missing-required.
   * Host-supplied hint only — not part of MappingDocument.
   */
  required?: boolean
}

/** One origin string → opaque host ref for `resolve: 'lookup'`. */
export type LookupEntry = {
  /** Trimmed origin source string (e.g. RSS author). */
  value: string
  /** Opaque host-stable id (`seedLocalId` or `seedUid`). Package does not interpret it. */
  ref: string
}

/**
 * Source → property edge.
 * A source may map to multiple properties; each property appears at most once.
 * `resolve: 'extract' | 'file'` is applied by `applyMappingAsync` via a host callback.
 * `resolve: 'lookup'` is applied from `lookup.entries` (sync and async).
 * `resolve: 'derive' | 'assemble'` are host-applied; sync/async apply skip them.
 * Derive-only edges omit `sourceId`.
 */
export type FieldMapping = {
  sourceId?: string
  propertyName: string
  resolve?: ResolveJob
  /** Stored string → ref assignments for `resolve: 'lookup'`. Omit or empty = unassigned. */
  lookup?: { entries: LookupEntry[] }
  /** Optional derive spec. Legal on `resolve: 'derive'` or as copy fallback. */
  derive?: DeriveSpec
  /** Named blocks for `resolve: 'assemble'`. Host-owned names. */
  assemble?: AssembleSpec
}

/**
 * Per-property string → seed uid (or uid list) dictionary for `resolve: 'lookup'`.
 * Keys are trimmed source values.
 *
 * @deprecated Prefer `FieldMapping.lookup.entries`. Read as a fallback only.
 */
export type MappingLookups = Record<string, Record<string, string | string[]>>

/** Persistable mapping authored in the UI (or programmatically). */
export type MappingDocument = {
  version: 1
  sourceKind: 'markdown' | 'rss' | 'xml'
  mappings: FieldMapping[]
  /**
   * Optional relation value maps keyed by property name.
   * @deprecated Prefer `FieldMapping.lookup.entries` on each lookup edge.
   */
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
  sourceId?: string
  propertyName: string
  resolve?: ResolveJob
  message: string
}

export type ApplyMappingAsyncResult = {
  properties: PropertyBag
  errors: ApplyMappingError[]
}
