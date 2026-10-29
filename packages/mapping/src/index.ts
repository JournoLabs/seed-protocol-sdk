export type {
  SourceKind,
  SourceNode,
  TargetProperty,
  FieldMapping,
  LookupEntry,
  LookupSeparator,
  MappingDocument,
  MappingLookups,
  PropertyBag,
  ResolveJob,
  DeriveSpec,
  AssembleSpec,
  UrlMediaClass,
  ResolveContext,
  ResolveCallback,
  ApplyMappingError,
  ApplyMappingAsyncResult,
  UnmatchedLookup,
} from './types'

export { applyMapping, applyMappingAsync, coerceValue } from './applyMapping'
export {
  isPresentEdge,
  omitEmptySourceId,
  applyResolveToEdge,
  withPreservedExtras,
  withDeriveSpec,
  withAssembleBlocks,
  clearSourceKeepDerive,
  isDeriveKeepOnClear,
} from './edgeMapping'
export type { ApplyMappingAsyncOptions } from './applyMapping'
export {
  isRelationLookupTarget,
  normalizeLookupKey,
  lookupKey,
  collectLookupValues,
  sampleValueFromSource,
  lookupEntriesFromMapping,
  lookupRefsFromEntries,
  resolveLookup,
  splitLookupValue,
  DEFAULT_LOOKUP_SEPARATORS,
  shapeLookupValue,
  withLookupEntries,
  withLookupSplit,
} from './relationLookup'
export type { LookupResolution } from './relationLookup'
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
