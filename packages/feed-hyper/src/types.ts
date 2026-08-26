import type { FeedFormat } from '@seedprotocol/feed'

export type PublishFeedOptions = {
  schemas: string[]
  formats: FeedFormat[]
  storePath: string
  driveName?: string
  pageSize?: number
  announce?: boolean
  includeArchives?: boolean
  /** Override channel site URL (home page). Default: current feed site config. */
  siteUrl?: string
  /**
   * When set, skip EAS/network generation and write these bodies instead.
   * Keys are drive paths (e.g. /posts/rss.xml). Used in tests.
   */
  fixtureContents?: Record<string, string>
}

export type PublishFeedResult = {
  key: string
  version: number
  paths: string[]
  hyperUrl: string
}

export type FeedRegistryEntry = {
  schema: string
  formats: FeedFormat[]
  paths: string[]
}

export type FeedRegistry = {
  key: string
  version: number
  updatedAt: string
  schemas: FeedRegistryEntry[]
}

export type OpenFeedOptions = {
  key: string
  storePath: string
  announce?: boolean
  /** Max ms to wait for initial sync when length is 0 (default: 15000). */
  syncTimeoutMs?: number
}

export type SeedFeedOptions = {
  key: string
  storePath: string
}

export type ServeFeedOptions = {
  key: string
  storePath: string
  port?: number
  host?: string
  announce?: boolean
}

export type ServeFeedResult = {
  key: string
  port: number
  host: string
  baseUrl: string
  close: () => Promise<void>
}
