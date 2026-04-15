import type { Request, Response } from 'express';

/**
 * Express Request/Response types for API routes
 * Use these types in your route handlers
 */
export type { Request, Response } from 'express';

/**
 * Express route handler function type
 */
export type ApiHandler = (req: Request, res: Response) => void | Promise<void>;


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

export interface GraphQLItem {
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

export interface GraphQLResponse<T> {
  data: {
    [key: string]: T[]
  }
  errors?: Array<{ message: string }>
}

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