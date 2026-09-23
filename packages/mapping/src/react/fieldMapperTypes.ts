import type {
  FieldMapping,
  LookupEntry,
  MappingLookups,
  ResolveJob,
  SourceNode,
  TargetProperty,
} from '../types'

/** Authoring surface. Prefer `'rows'`; `'wires'` is deprecated but still supported. */
export type FieldMapperLayout = 'rows' | 'wires'

export type FieldMapperRowKey = 'property' | 'source'

export type FieldMapperDefaultRows =
  | 'requiredAndMapped'
  | 'mapped'
  | 'all'

export type FieldMapperOption = {
  value: string
  label: string
  sample?: string
  kind?: string
  dataType?: string
}

export type FieldMapperRowState =
  | 'empty'
  | 'mapped'
  | 'needsResolve'
  | 'needsLookup'
  | 'conflict'

export type FieldMapperRow = {
  /** Property name in property mode; synthetic edge id in source mode. */
  id: string
  target?: TargetProperty
  mapping?: FieldMapping
  source?: SourceNode
  /** Normalized origin sample string for the current source. */
  sampleValue: string
  /** Sync preview, or a description of what the host resolver will produce. */
  preview: string
  /** Transform this edge needs to yield a usable value, if any. */
  requiredResolve: ResolveJob | null
  state: FieldMapperRowState
}

export type FieldMapperLookupRow = FieldMapperRow & {
  onLookupChange: (entries: LookupEntry[]) => void
}

export type FieldMapperCoverage = {
  mapped: number
  total: number
  missingRequired: string[]
}

export type UseFieldMapperArgs = {
  sources: SourceNode[]
  targets: TargetProperty[]
  mappings: FieldMapping[]
  onChange: (mappings: FieldMapping[]) => void
  /**
   * @deprecated Prefer `FieldMapping.lookup.entries`. Read as a fallback for preview.
   */
  lookups?: MappingLookups
  /**
   * @deprecated Prefer `setLookupEntries` / `renderLookup`. Still clears the
   * document-level table when a lookup edge is removed.
   */
  onLookupsChange?: (lookups: MappingLookups) => void
  rowKey?: FieldMapperRowKey
  onAutoMap?: () => FieldMapping[]
}

export type UseFieldMapperResult = {
  rows: FieldMapperRow[]
  sourceOptions: FieldMapperOption[]
  propertyOptions: FieldMapperOption[]
  addableProperties: TargetProperty[]
  coverage: FieldMapperCoverage
  /** Row ids whose property is already filled by an earlier row. Empty in property mode. */
  conflicts: Set<string>
  setSource: (rowId: string, sourceId: string | null) => void
  setProperty: (rowId: string, propertyName: string) => void
  setTransform: (rowId: string, resolve: ResolveJob | null) => void
  /** Write `lookup.entries` on the edge for this row. Empty list omits `lookup`. */
  setLookupEntries: (rowId: string, entries: LookupEntry[]) => void
  addRow: (propertyName?: string) => void
  removeRow: (rowId: string) => void
  autoMap: () => void
  /**
   * Wires-layout helper: property-exclusive connect from a (possibly derived)
   * source id. Normalizes `@extract`/`@file` and auto-attaches lookup.
   */
  connect: (sourceId: string, propertyName: string) => void
  /** Remove every edge for a source (including derived resolve ids). */
  removeBySource: (sourceId: string) => void
}
