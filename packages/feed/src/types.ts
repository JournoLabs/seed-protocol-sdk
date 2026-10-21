export type FeedFormat = 'rss' | 'atom' | 'json'

export interface TransformOptions {
  schemaName: string
  siteUrl: string
  /** When set, item URLs use {itemUrlBase}/{itemUrlPath}/{uid} (e.g. EASScan attestation links) */
  itemUrlBase?: string
  /** Path for attestation links when itemUrlBase is set (default: attestation/view) */
  itemUrlPath?: string
  /**
   * `omit_items` (default): drop feed entries whose rich-text fields contain `data:image/` URIs (large RSS payloads).
   * `include_items`: keep those entries (opt-in).
   */
  richTextDataUriImages?: 'omit_items' | 'include_items'
}

export interface FeedConfig {
  title: string
  description: string
  siteUrl: string
  feedUrl: string
  language?: string
  copyright?: string
  author?: {
    name: string
    email?: string
    link?: string
  }
}

/** A feed entry: an assembled seed record's `data` with feed defaults applied. */
export interface FeedItem {
  id: string
  title: string
  summary?: string
  /** Full HTML body; often the same logical field as `body` for `dataType: 'Html'`. */
  html?: string
  Html?: string
  /** Common property name for `Html` fields (e.g. article `body`). */
  body?: string
  Body?: string
  /** Alternate rich body / plain body string. */
  content?: string
  Content?: string
  description?: string
  Description?: string
  text?: string
  Text?: string
  createdAt?: string
  updatedAt?: string
  publishedAt?: string
  authors?: Array<{
    name: string
    displayName?: string
    profile?: string
  }>
  featureImage?: {
    src: string
    alt?: string
  }
  [key: string]: unknown
}

/** @deprecated Use {@link FeedItem}. Items come from `@seedprotocol/query`, not GraphQL. */
export type GraphQLItem = FeedItem

/**
 * Image metadata extracted from Arweave transaction
 */
export interface ImageMetadata {
  isImage: boolean
  url: string
  mimeType?: string
  width?: number
  height?: number
  size?: number // bytes
  format?: string // 'jpeg', 'png', 'webp', 'gif', 'svg', etc.
}