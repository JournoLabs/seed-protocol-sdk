import { classifyUrl, looksLikeUrl } from './classifyUrl'
import type {
  FieldMapping,
  ResolveJob,
  SourceNode,
  UrlMediaClass,
} from './types'

export const RESOLVE_EXTRACT_SUFFIX = '@extract'
export const RESOLVE_FILE_SUFFIX = '@file'

function contentTypeFromMeta(meta?: Record<string, unknown>): string | undefined {
  if (!meta) return undefined
  const ct = meta.contentType ?? meta.type
  return typeof ct === 'string' && ct.trim() ? ct.trim() : undefined
}

function mediaClassFromSource(source: SourceNode): UrlMediaClass {
  const metaClass = source.meta?.class
  if (
    metaClass === 'html' ||
    metaClass === 'image' ||
    metaClass === 'audio' ||
    metaClass === 'video' ||
    metaClass === 'unknown'
  ) {
    return metaClass
  }
  const url =
    typeof source.meta?.url === 'string' && source.meta.url.trim()
      ? source.meta.url.trim()
      : source.value
  return classifyUrl({
    url,
    contentType: contentTypeFromMeta(source.meta),
  })
}

function isUrlCandidate(source: SourceNode): boolean {
  if (source.kind === 'resolved') return false
  if (source.kind === 'full' || source.kind === 'section') return false
  const url =
    typeof source.meta?.url === 'string' && source.meta.url.trim()
      ? source.meta.url.trim()
      : source.value
  return looksLikeUrl(url)
}

/**
 * Parse a package-owned derived source id (`origin@extract` / `origin@file`).
 */
export function parseResolvedSourceId(
  sourceId: string,
): { originId: string; resolve: ResolveJob } | null {
  if (sourceId.endsWith(RESOLVE_EXTRACT_SUFFIX)) {
    return {
      originId: sourceId.slice(0, -RESOLVE_EXTRACT_SUFFIX.length),
      resolve: 'extract',
    }
  }
  if (sourceId.endsWith(RESOLVE_FILE_SUFFIX)) {
    return {
      originId: sourceId.slice(0, -RESOLVE_FILE_SUFFIX.length),
      resolve: 'file',
    }
  }
  return null
}

/**
 * Normalize a UI selection (possibly a derived `@extract` / `@file` node)
 * into a persistable FieldMapping with `resolve` on the origin source.
 */
export function normalizeMappingFromSourceId(
  sourceId: string,
  propertyName: string,
): FieldMapping {
  const parsed = parseResolvedSourceId(sourceId)
  if (!parsed) {
    return { sourceId, propertyName }
  }
  return {
    sourceId: parsed.originId,
    propertyName,
    resolve: parsed.resolve,
  }
}

/**
 * Stable display id for a derived resolve candidate.
 */
export function resolvedSourceId(originId: string, job: ResolveJob): string {
  return job === 'extract'
    ? `${originId}${RESOLVE_EXTRACT_SUFFIX}`
    : `${originId}${RESOLVE_FILE_SUFFIX}`
}

/**
 * Expand URL-classifiable sources with package-owned extract/file candidates
 * for FieldMapper / autoMap. Original nodes are preserved.
 *
 * Prefer mapping derived nodes in the UI; persist via
 * `normalizeMappingFromSourceId` so documents store origin + `resolve`.
 */
export function buildResolvedSourceNodes(sources: SourceNode[]): SourceNode[] {
  const out: SourceNode[] = [...sources]
  const existing = new Set(sources.map((s) => s.id))

  for (const source of sources) {
    if (!isUrlCandidate(source)) continue

    const url =
      typeof source.meta?.url === 'string' && source.meta.url.trim()
        ? source.meta.url.trim()
        : source.value.trim()
    const contentType = contentTypeFromMeta(source.meta)
    const mediaClass = mediaClassFromSource(source)

    const extractId = resolvedSourceId(source.id, 'extract')
    if (!existing.has(extractId)) {
      out.push({
        id: extractId,
        label: `${source.label} → extract HTML`,
        kind: 'resolved',
        value: url,
        meta: {
          originId: source.id,
          resolve: 'extract' satisfies ResolveJob,
          class: 'html' satisfies UrlMediaClass,
          contentType,
          url,
        },
      })
      existing.add(extractId)
    }

    const fileId = resolvedSourceId(source.id, 'file')
    if (!existing.has(fileId)) {
      out.push({
        id: fileId,
        label: `${source.label} → file`,
        kind: 'resolved',
        value: url,
        meta: {
          originId: source.id,
          resolve: 'file' satisfies ResolveJob,
          class: mediaClass,
          contentType,
          url,
        },
      })
      existing.add(fileId)
    }
  }

  return out
}

/**
 * Look up the origin source for a mapping (handles resolve edges).
 */
export function resolveMappingSource(
  sources: SourceNode[],
  mapping: FieldMapping,
): SourceNode | undefined {
  const byId = new Map(sources.map((s) => [s.id, s]))
  const direct = byId.get(mapping.sourceId)
  if (direct) return direct
  if (mapping.resolve) {
    const derived = byId.get(resolvedSourceId(mapping.sourceId, mapping.resolve))
    if (derived) return derived
  }
  return undefined
}
