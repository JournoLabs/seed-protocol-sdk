import { classifyUrl, looksLikeUrl } from './classifyUrl'
import { isRelationLookupTarget } from './relationLookup'
import type { FieldMapping, SourceNode, TargetProperty, UrlMediaClass } from './types'

const FULL_DOC_PROP_NAMES = ['text', 'content', 'body', 'fulltext', 'markdown']
const HTML_PROP_NAMES = ['html', 'content', 'body', 'text']
const IMAGE_PROP_ALIASES = [
  'featureimage',
  'feature_image',
  'image',
  'cover',
  'coverimage',
]
const FILE_PROP_ALIASES = ['file', 'audio', 'video', 'enclosure', 'attachment', 'media']
const URL_PROP_ALIASES = ['importurl', 'canonicalurl', 'url', 'link', 'permalink']

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/[:_-]/g, '')
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

/**
 * Sources that fan out to every unused target matching any alias.
 * Keys are normalized source label/id fragments.
 */
const FAN_OUT_ALIASES: Record<string, string[]> = {
  link: URL_PROP_ALIASES,
  url: URL_PROP_ALIASES,
}

function fanOutAliasesForSource(source: SourceNode): string[] | undefined {
  if (source.kind === 'resolved') return undefined
  const labelKey = normalizeName(source.label)
  const idKey = normalizeName(source.id.replace(/^rss-/, '').replace(/^fm-/, ''))
  return FAN_OUT_ALIASES[labelKey] ?? FAN_OUT_ALIASES[idKey]
}

function contentTypeFromMeta(meta?: Record<string, unknown>): string | undefined {
  if (!meta) return undefined
  const ct = meta.contentType ?? meta.type
  return typeof ct === 'string' && ct.trim() ? ct.trim() : undefined
}

function mediaClassOf(source: SourceNode): UrlMediaClass {
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

function isRawUrlSource(source: SourceNode): boolean {
  if (source.kind === 'resolved') return false
  if (source.kind === 'full' || source.kind === 'section') return false
  // content:encoded / description HTML bodies are not "raw URL" sources
  const labelKey = normalizeName(source.label)
  if (
    labelKey === 'contentencoded' ||
    labelKey === 'content' ||
    labelKey === 'description' ||
    labelKey === 'summary' ||
    labelKey === 'title'
  ) {
    return false
  }
  const url =
    typeof source.meta?.url === 'string' && source.meta.url.trim()
      ? source.meta.url.trim()
      : source.value
  return looksLikeUrl(url) && !url.trim().includes('<')
}

function isHtmlLikeTarget(target: TargetProperty): boolean {
  const n = normalizeName(target.name)
  return (
    HTML_PROP_NAMES.some((p) => namesMatch(n, p)) ||
    target.dataType === 'Html' ||
    target.dataType === 'Text'
  )
}

function isRichMediaTarget(target: TargetProperty): boolean {
  const n = normalizeName(target.name)
  if (
    target.dataType === 'Image' ||
    target.dataType === 'File' ||
    target.dataType === 'Relation'
  ) {
    return (
      IMAGE_PROP_ALIASES.some((a) => namesMatch(n, a)) ||
      FILE_PROP_ALIASES.some((a) => namesMatch(n, a)) ||
      target.dataType === 'Image' ||
      target.dataType === 'File'
    )
  }
  return (
    IMAGE_PROP_ALIASES.some((a) => namesMatch(n, a)) ||
    FILE_PROP_ALIASES.some((a) => namesMatch(n, a))
  )
}

function isUrlOnlyTarget(target: TargetProperty): boolean {
  const n = normalizeName(target.name)
  return URL_PROP_ALIASES.some((a) => namesMatch(n, a))
}

function findImageTarget(
  targets: TargetProperty[],
  usedProps: Set<string>,
): TargetProperty | undefined {
  return targets.find((p) => {
    if (usedProps.has(p.name)) return false
    const n = normalizeName(p.name)
    return (
      p.dataType === 'Image' ||
      IMAGE_PROP_ALIASES.some((a) => namesMatch(n, a))
    )
  })
}

function findFileTarget(
  targets: TargetProperty[],
  usedProps: Set<string>,
  mediaClass: UrlMediaClass,
): TargetProperty | undefined {
  return targets.find((p) => {
    if (usedProps.has(p.name)) return false
    const n = normalizeName(p.name)
    if (mediaClass === 'audio' && namesMatch(n, 'audio')) return true
    if (mediaClass === 'video' && namesMatch(n, 'video')) return true
    return p.dataType === 'File' || FILE_PROP_ALIASES.some((a) => namesMatch(n, a))
  })
}

function findHtmlTarget(
  targets: TargetProperty[],
  usedProps: Set<string>,
): TargetProperty | undefined {
  return targets.find((p) => {
    if (usedProps.has(p.name)) return false
    const n = normalizeName(p.name)
    return (
      p.dataType === 'Html' ||
      HTML_PROP_NAMES.some((alias) => namesMatch(n, alias))
    )
  })
}

/**
 * Heuristic auto-map: full-document / full-text first, then RSS aliases,
 * URL fan-out (copy only), media file/extract jobs, then fuzzy name match.
 * Never maps a raw URL onto html / Image / File without `resolve`.
 */
export function autoMap(
  sources: SourceNode[],
  targets: TargetProperty[],
): FieldMapping[] {
  const mappings: FieldMapping[] = []
  const usedProps = new Set<string>()
  const usedSources = new Set<string>()

  // Skip derived resolve nodes in the main pass; we emit resolve jobs from origins.
  const baseSources = sources.filter((s) => s.kind !== 'resolved')

  const fullSource = baseSources.find((s) => s.kind === 'full')
  if (fullSource) {
    const fullDocMatch = targets.find((p) =>
      FULL_DOC_PROP_NAMES.includes(p.name.toLowerCase()),
    )
    if (fullDocMatch) {
      mappings.push({
        sourceId: fullSource.id,
        propertyName: fullDocMatch.name,
      })
      usedProps.add(fullDocMatch.name)
      usedSources.add(fullSource.id)
    }
  }

  const rssAliases: Record<string, string[]> = {
    title: ['title', 'name', 'headline'],
    'content:encoded': ['html', 'content', 'body', 'text'],
    content: ['html', 'content', 'body', 'text'],
    description: ['summary', 'description', 'excerpt'],
    summary: ['summary', 'description', 'excerpt'],
    featureimage: ['featureimage', 'feature_image', 'image', 'cover'],
    feature_image: ['featureimage', 'feature_image', 'image', 'cover'],
    link: ['url', 'link', 'permalink'],
    creator: ['author', 'authors', 'creator', 'byline'],
    author: ['author', 'authors', 'creator', 'byline'],
  }

  // Prefer full-text RSS → html (copy) before URL extract
  for (const source of baseSources) {
    if (usedSources.has(source.id)) continue
    const labelKey = normalizeName(source.label)
    const idKey = source.id.replace(/^rss-/, '').replace(/^fm-/, '')
    if (
      labelKey === 'contentencoded' ||
      normalizeName(idKey) === 'contentencoded' ||
      (labelKey === 'content' && source.value.includes('<'))
    ) {
      const htmlTarget = findHtmlTarget(targets, usedProps)
      if (htmlTarget) {
        mappings.push({ sourceId: source.id, propertyName: htmlTarget.name })
        usedProps.add(htmlTarget.name)
        usedSources.add(source.id)
      }
    }
  }

  for (const source of baseSources) {
    if (usedSources.has(source.id)) continue

    const fanOutAliases = fanOutAliasesForSource(source)
    if (fanOutAliases) {
      for (const target of targets) {
        if (usedProps.has(target.name)) continue
        if (isRichMediaTarget(target) && !isUrlOnlyTarget(target)) continue
        if (isHtmlLikeTarget(target) && !isUrlOnlyTarget(target)) {
          // Do not fan raw link into html — handled later as extract if needed
          const n = normalizeName(target.name)
          if (n === 'html' || target.dataType === 'Html') continue
        }
        const matches = fanOutAliases.some((alias) =>
          namesMatch(target.name, alias),
        )
        if (matches) {
          mappings.push({ sourceId: source.id, propertyName: target.name })
          usedProps.add(target.name)
        }
      }
      continue
    }

    // Media URL sources → resolve:file onto Image/File targets
    if (isRawUrlSource(source)) {
      const mediaClass = mediaClassOf(source)
      if (mediaClass === 'image') {
        const imageTarget = findImageTarget(targets, usedProps)
        if (imageTarget) {
          mappings.push({
            sourceId: source.id,
            propertyName: imageTarget.name,
            resolve: 'file',
          })
          usedProps.add(imageTarget.name)
          usedSources.add(source.id)
          continue
        }
      }
      if (mediaClass === 'audio' || mediaClass === 'video') {
        const fileTarget = findFileTarget(targets, usedProps, mediaClass)
        if (fileTarget) {
          mappings.push({
            sourceId: source.id,
            propertyName: fileTarget.name,
            resolve: 'file',
          })
          usedProps.add(fileTarget.name)
          usedSources.add(source.id)
          continue
        }
      }
      // Unknown / html-class URLs: do not map onto rich media without resolve
      // (extract handled in a later pass for link-like sources)
    }

    const labelKey = normalizeName(source.label)
    const idKey = source.id.replace(/^rss-/, '').replace(/^fm-/, '')
    const aliasKeys = [
      ...(rssAliases[source.label] ?? []),
      ...(rssAliases[idKey] ?? []),
      ...(rssAliases[labelKey] ?? []),
    ]

    let match: TargetProperty | undefined

    for (const alias of aliasKeys) {
      match = targets.find(
        (p) => !usedProps.has(p.name) && namesMatch(p.name, alias),
      )
      if (match) break
    }

    if (!match) {
      match = targets.find(
        (p) =>
          !usedProps.has(p.name) &&
          (namesMatch(p.name, source.label) || namesMatch(p.name, idKey)),
      )
    }

    if (match) {
      // Block raw URL → html / image / file without resolve
      if (
        isRawUrlSource(source) &&
        (isHtmlLikeTarget(match) || isRichMediaTarget(match)) &&
        !isUrlOnlyTarget(match)
      ) {
        // skip — extract / file jobs handled separately
      } else if (
        isRawUrlSource(source) &&
        mediaClassOf(source) === 'image' &&
        isRichMediaTarget(match)
      ) {
        mappings.push({
          sourceId: source.id,
          propertyName: match.name,
          resolve: 'file',
        })
        usedProps.add(match.name)
        usedSources.add(source.id)
      } else if (isRelationLookupTarget(match)) {
        mappings.push({
          sourceId: source.id,
          propertyName: match.name,
          resolve: 'lookup',
        })
        usedProps.add(match.name)
        usedSources.add(source.id)
      } else {
        mappings.push({ sourceId: source.id, propertyName: match.name })
        usedProps.add(match.name)
        usedSources.add(source.id)
      }
    }
  }

  // If no HTML body filled, prefer extract from link/permalink
  const htmlStillFree = findHtmlTarget(targets, usedProps)
  if (htmlStillFree) {
    const linkSource = baseSources.find((s) => {
      if (usedSources.has(s.id) && !fanOutAliasesForSource(s)) return false
      const labelKey = normalizeName(s.label)
      const idKey = normalizeName(s.id.replace(/^rss-/, '').replace(/^fm-/, ''))
      return (
        (labelKey === 'link' ||
          labelKey === 'url' ||
          idKey === 'link' ||
          idKey === 'url' ||
          labelKey === 'permalink') &&
        looksLikeUrl(s.value)
      )
    })
    if (linkSource) {
      mappings.push({
        sourceId: linkSource.id,
        propertyName: htmlStillFree.name,
        resolve: 'extract',
      })
      usedProps.add(htmlStillFree.name)
    }
  }

  return mappings
}
