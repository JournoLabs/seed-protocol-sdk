import pluralize from 'pluralize'
import type { FeedFormat } from '@seedprotocol/feed'

export type ArchivePathOptions = {
  year: number
  month: number
}

/**
 * Map schema + format (+ optional archive) to a Hyperdrive path.
 * Layout mirrors feed HTTP routes with file extensions for Content-Type detection:
 *   /posts/rss.xml
 *   /posts/atom.xml
 *   /posts/feed.json
 *   /posts/archive/2024/2/rss.xml
 */
export function feedDrivePath(
  schemaName: string,
  format: FeedFormat,
  archive?: ArchivePathOptions,
): string {
  const collection = pluralize(schemaName.toLowerCase())
  const file =
    format === 'json' ? 'feed.json' : format === 'atom' ? 'atom.xml' : 'rss.xml'

  if (archive) {
    return `/${collection}/archive/${archive.year}/${archive.month}/${file}`
  }
  return `/${collection}/${file}`
}

/** Registry manifest path on every published feed drive. */
export const REGISTRY_PATH = '/registry.json'

/**
 * HTTP path segment for createFeed / channel self-links (no file extension),
 * matching historical feed.seedprotocol.io routes: /posts/rss
 */
export function feedHttpPath(schemaName: string, format: FeedFormat): string {
  const collection = pluralize(schemaName.toLowerCase())
  return `/${collection}/${format}`
}

/**
 * Map a gateway request pathname to the on-drive file path.
 * Accepts both historical HTTP shapes (`/posts/rss`) and drive shapes (`/posts/rss.xml`).
 * Unknown paths pass through unchanged.
 */
export function resolveHttpToDrivePath(pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

  // Already a drive file path with a known feed extension
  if (/\.(xml|json)$/i.test(trimmed)) return trimmed

  // /{collection}/rss|atom|json
  // /{collection}/archive/{year}/{month}/rss|atom|json
  const match = trimmed.match(
    /^(\/[^/]+(?:\/archive\/\d+\/\d+)?)\/(rss|atom|json)$/i,
  )
  if (!match) return trimmed

  const base = match[1]!
  const format = match[2]!.toLowerCase()
  if (format === 'json') return `${base}/feed.json`
  if (format === 'atom') return `${base}/atom.xml`
  return `${base}/rss.xml`
}

export function hyperFeedUrl(keyZ32: string): string {
  return `hyper://${keyZ32}`
}
