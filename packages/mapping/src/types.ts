/** Kind of a source field extracted from an external document. */
export type SourceKind =
  | 'frontmatter'
  | 'section'
  | 'full'
  | 'rssField'
  | 'xmlPath'

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
}

/** One-to-one connection from a source node to a model property. */
export type FieldMapping = {
  sourceId: string
  propertyName: string
}

/** Persistable mapping authored in the UI (or programmatically). */
export type MappingDocument = {
  version: 1
  sourceKind: 'markdown' | 'rss' | 'xml'
  mappings: FieldMapping[]
}

/** Result of applying mappings: property name → coerced value. */
export type PropertyBag = Record<string, unknown>
