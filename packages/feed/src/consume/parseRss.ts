import Parser from 'rss-parser'

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

/** The lists `customFields` keeps for repeated `dc:creator` and `author` elements. */
const REPEATED_NAME_LISTS = ['creatorList', 'authorList'] as const

/** A repeated element's text. An Atom `<author>` parses to `{ name: [text] }`. */
function elementName(raw: unknown): string | undefined {
  const name = raw && typeof raw === 'object' ? (raw as { name?: unknown }).name : raw
  const text = Array.isArray(name) ? name[0] : name
  return typeof text === 'string' && text.trim() ? text.normalize('NFC').replace(/\s+/g, ' ').trim() : undefined
}

/**
 * Each name once, in document order, matched as @seedprotocol/mapping's lookups match (whitespace
 * collapsed, case-folded), keeping the first spelling.
 */
function distinctNames(list: unknown[]): string[] {
  const byKey = new Map<string, string>()
  for (const raw of list) {
    const name = elementName(raw)
    const key = name?.toUpperCase().toLowerCase()
    if (name && key && !byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()]
}

function withNameLists(item: Record<string, unknown>): Record<string, unknown> {
  for (const key of REPEATED_NAME_LISTS) {
    if (Array.isArray(item[key])) item[key] = distinctNames(item[key])
  }
  return item
}

/**
 * Parse RSS or Atom XML into channel metadata and plain item records for `normalizeFeedItemFields`.
 * `creatorList` and `authorList` hold each repeated `dc:creator` or `author` name as a string, once.
 */
const parser = new Parser({
  customFields: {
    item: [
      'featureImage',
      'feature_image',
      'content:encoded',
      'seedUid',
      'SeedUid',
      ['dc:creator', 'creatorList', { keepArray: true }],
      ['author', 'authorList', { keepArray: true }],
    ],
  },
})

export async function parseRssString(xml: string): Promise<ParsedRssChannel> {
  const feed = await parser.parseString(xml)
  return {
    title: feed.title,
    link: feed.link,
    description: feed.description,
    items: (feed.items ?? []).map((item) => withNameLists(toPlainItem(item))),
  }
}
