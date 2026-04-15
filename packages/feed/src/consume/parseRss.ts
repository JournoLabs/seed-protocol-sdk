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

/** Parse RSS or Atom XML into channel metadata and plain item records for `normalizeFeedItemFields`. */
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

export async function parseRssString(xml: string): Promise<ParsedRssChannel> {
  const feed = await parser.parseString(xml)
  return {
    title: feed.title,
    link: feed.link,
    description: feed.description,
    items: (feed.items ?? []).map(toPlainItem),
  }
}
