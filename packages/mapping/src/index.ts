export type {
  SourceKind,
  SourceNode,
  TargetProperty,
  FieldMapping,
  LookupEntry,
  MappingDocument,
  MappingLookups,
  PropertyBag,
  ResolveJob,
  UrlMediaClass,
  ResolveContext,
  ResolveCallback,
  ApplyMappingError,
  ApplyMappingAsyncResult,
} from './types'

export { applyMapping, applyMappingAsync, coerceValue } from './applyMapping'
export type { ApplyMappingAsyncOptions } from './applyMapping'
export {
  isRelationLookupTarget,
  normalizeLookupKey,
  sampleValueFromSource,
  lookupEntriesFromMapping,
  lookupRefFromEntries,
  resolveLookupMapped,
  shapeLookupValue,
  withLookupEntries,
} from './relationLookup'
export { autoMap } from './autoMap'
export { classifyUrl, looksLikeUrl } from './classifyUrl'
export type { ClassifyUrlInput } from './classifyUrl'
export {
  buildResolvedSourceNodes,
  normalizeMappingFromSourceId,
  parseResolvedSourceId,
  resolvedSourceId,
  resolveMappingSource,
  RESOLVE_EXTRACT_SUFFIX,
  RESOLVE_FILE_SUFFIX,
} from './resolvedSources'

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
