import Parser from 'rss-parser'
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
 */
const parser = new Parser({
  customFields: {
    item: [
      'featureImage',
      'feature_image',
      'content:encoded',
      'seedUid',
      'SeedUid',
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

/**
 * Flatten a parsed RSS/Atom item into SourceNodes (one per string-coercible key).
 * Stable ids: `rss-{key}`.
 */
export function rssItemToSources(item: Record<string, unknown>): SourceNode[] {
  const sources: SourceNode[] = []
  const seen = new Set<string>()

  for (const [key, raw] of Object.entries(item)) {
    if (key === 'items' || key.startsWith('$')) continue
    const value = coerceFieldValue(raw)
    if (value == null) continue
    if (seen.has(key)) continue
    seen.add(key)

    sources.push({
      id: `rss-${key}`,
      label: key,
      kind: 'rssField',
      value,
    })
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
