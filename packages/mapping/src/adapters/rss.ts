import Parser from 'rss-parser'
import { classifyUrl } from '../classifyUrl'
import type { SourceNode } from '../types'

export type ParsedRssChannel = {
  title?: string
  link?: string
  description?: string
  /** Plain serializable item records (dates become ISO strings). */
  items: Record<string, unknown>[]
}

function toPlainItem(item: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(item)) as Record<string, unknown>
  } catch {
    return { ...(item as Record<string, unknown>) }
  }
}

/**
 * Same shape and customFields as @seedprotocol/feed `parseRssString`
 * so RSS mapping stays aligned without importing feed's heavy barrel.
 * Also pulls enclosure / media:content for structured media nodes.
 */
const parser = new Parser({
  customFields: {
    item: [
      'featureImage',
      'feature_image',
      'content:encoded',
      'seedUid',
      'SeedUid',
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
})

async function parseRssString(xml: string): Promise<ParsedRssChannel> {
  const feed = await parser.parseString(xml)
  return {
    title: feed.title,
    link: feed.link,
    description: feed.description,
    items: (feed.items ?? []).map(toPlainItem),
  }
}

function coerceFieldValue(val: unknown): string | null {
  if (val == null) return null
  if (typeof val === 'string') {
    const t = val.trim()
    return t.length > 0 ? t : null
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val)
  }
  if (Array.isArray(val)) {
    try {
      return JSON.stringify(val)
    } catch {
      return null
    }
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (typeof obj._ === 'string' && obj._.trim()) return obj._.trim()
    if (typeof obj.value === 'string' && obj.value.trim()) return obj.value.trim()
    try {
      return JSON.stringify(val)
    } catch {
      return null
    }
  }
  return null
}

type MediaAttrs = {
  url: string
  contentType?: string
  length?: string
}

function pickMediaAttrs(raw: unknown): MediaAttrs | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    const url = raw.trim()
    return url ? { url } : null
  }
  if (typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  // rss-parser often nests attrs under `$`
  const dollar =
    obj.$ && typeof obj.$ === 'object'
      ? (obj.$ as Record<string, unknown>)
      : undefined
  const urlCandidate =
    (typeof obj.url === 'string' && obj.url) ||
    (typeof dollar?.url === 'string' && dollar.url) ||
    (typeof obj.link === 'string' && obj.link) ||
    null
  if (!urlCandidate || !String(urlCandidate).trim()) return null

  const typeRaw =
    (typeof obj.type === 'string' && obj.type) ||
    (typeof dollar?.type === 'string' && dollar.type) ||
    (typeof obj.medium === 'string' && obj.medium) ||
    undefined
  const lengthRaw =
    (typeof obj.length === 'string' && obj.length) ||
    (typeof obj.length === 'number' && String(obj.length)) ||
    (typeof dollar?.length === 'string' && dollar.length) ||
    (typeof dollar?.length === 'number' && String(dollar.length)) ||
    undefined

  return {
    url: String(urlCandidate).trim(),
    contentType: typeRaw ? String(typeRaw).trim() : undefined,
    length: lengthRaw ? String(lengthRaw).trim() : undefined,
  }
}

function mediaEntriesFromValue(raw: unknown): MediaAttrs[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw.map(pickMediaAttrs).filter((m): m is MediaAttrs => m != null)
  }
  const one = pickMediaAttrs(raw)
  return one ? [one] : []
}

const MEDIA_KEYS = new Set([
  'enclosure',
  'enclosures',
  'media:content',
  'mediaContent',
  'media:thumbnail',
  'mediaThumbnail',
])

function pushMediaNode(
  sources: SourceNode[],
  seen: Set<string>,
  id: string,
  label: string,
  media: MediaAttrs,
): void {
  if (seen.has(id)) return
  seen.add(id)
  const mediaClass = classifyUrl({
    url: media.url,
    contentType: media.contentType,
  })
  sources.push({
    id,
    label,
    kind: 'rssField',
    value: media.url,
    meta: {
      url: media.url,
      contentType: media.contentType,
      length: media.length,
      class: mediaClass,
    },
  })
}

/**
 * Flatten a parsed RSS/Atom item into SourceNodes (one per string-coercible key).
 * Enclosure / media:content become url + type in `meta` (not stringified objects).
 * Stable ids: `rss-{key}`, `rss-enclosure-0`, …
 */
export function rssItemToSources(item: Record<string, unknown>): SourceNode[] {
  const sources: SourceNode[] = []
  const seen = new Set<string>()

  let enclosureIndex = 0
  for (const [key, raw] of Object.entries(item)) {
    if (key === 'items' || key.startsWith('$')) continue

    if (MEDIA_KEYS.has(key)) {
      const entries = mediaEntriesFromValue(raw)
      for (const media of entries) {
        const id =
          key === 'enclosure' || key === 'enclosures'
            ? `rss-enclosure-${enclosureIndex}`
            : `rss-${key}-${enclosureIndex}`
        const label =
          key === 'enclosure' || key === 'enclosures'
            ? `enclosure[${enclosureIndex}]`
            : `${key}[${enclosureIndex}]`
        pushMediaNode(sources, seen, id, label, media)
        enclosureIndex += 1
      }
      continue
    }

    const value = coerceFieldValue(raw)
    if (value == null) continue
    if (seen.has(key)) continue
    seen.add(key)

    const node: SourceNode = {
      id: `rss-${key}`,
      label: key,
      kind: 'rssField',
      value,
    }

    // Feature image URLs: attach class hint when value looks like a URL
    if (
      (key === 'featureImage' || key === 'feature_image') &&
      /^https?:\/\//i.test(value)
    ) {
      node.meta = {
        url: value,
        class: classifyUrl({ url: value }),
      }
    }

    sources.push(node)
  }

  return sources
}

export type RssXmlSourcesResult = {
  channel: {
    title?: string
    link?: string
    description?: string
  }
  /** Source nodes for each feed item, in document order. */
  items: SourceNode[][]
}

/**
 * Parse RSS/Atom XML and map each item to SourceNodes via rssItemToSources.
 * Compatible with @seedprotocol/feed `parseRssString` field set.
 */
export async function rssXmlToSources(
  xml: string,
): Promise<RssXmlSourcesResult> {
  const parsed = await parseRssString(xml)
  return {
    channel: {
      title: parsed.title,
      link: parsed.link,
      description: parsed.description,
    },
    items: parsed.items.map((item) => rssItemToSources(item)),
  }
}
