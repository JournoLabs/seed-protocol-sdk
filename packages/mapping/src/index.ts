export type {
  SourceKind,
  SourceNode,
  TargetProperty,
  FieldMapping,
  MappingDocument,
  PropertyBag,
} from './types'

export { applyMapping, coerceValue } from './applyMapping'
export { autoMap } from './autoMap'

export {
  markdownToSources,
  parseMarkdownWithFrontmatter,
  parseMarkdownSections,
  SECTION_FULL_ID,
} from './adapters/markdown'

export {
  rssItemToSources,
  rssXmlToSources,
  type RssXmlSourcesResult,
} from './adapters/rss'

export { FieldMapper, type FieldMapperProps } from './react/FieldMapper'
