import type { FeedConfig } from './types';

/**
 * Partial site/feed metadata overrides. Unspecified fields keep current/default values.
 * `author` fields are merged individually when provided.
 */
export type SiteConfigOverrides = Partial<Omit<FeedConfig, 'author'>> & {
  author?: Partial<NonNullable<FeedConfig['author']>>;
};

/** Hardcoded Seed Protocol defaults for feed channel metadata. */
export const DEFAULT_SITE_CONFIG: FeedConfig = {
  title: 'Seed Protocol',
  description: 'Content published via Seed Protocol',
  siteUrl: 'https://seedprotocol.io',
  feedUrl: 'https://feed.seedprotocol.io',
  language: 'en',
  copyright: `© ${new Date().getFullYear()} All rights reserved`,
  author: {
    name: 'Seed Protocol',
    email: 'info@seedprotocol.io',
    link: 'https://seedprotocol.io',
  },
};

function cloneSiteConfig(config: FeedConfig): FeedConfig {
  return {
    ...config,
    author: config.author ? { ...config.author } : undefined,
  };
}

let siteConfig: FeedConfig = cloneSiteConfig(DEFAULT_SITE_CONFIG);

/**
 * Merge overrides onto a base site config. Missing fields keep the base values.
 */
export function resolveSiteConfig(
  overrides?: SiteConfigOverrides,
  base: FeedConfig = siteConfig,
): FeedConfig {
  if (!overrides) {
    return cloneSiteConfig(base);
  }

  const resolved: FeedConfig = {
    ...base,
    ...overrides,
    author: base.author ? { ...base.author } : undefined,
  };

  if (overrides.author !== undefined) {
    resolved.author = {
      ...(resolved.author ?? { name: '' }),
      ...overrides.author,
      name: overrides.author.name ?? resolved.author?.name ?? '',
    };
  }

  return resolved;
}

/** Current site/feed channel config (defaults until `setSiteConfig` is called). */
export function getSiteConfig(): FeedConfig {
  return cloneSiteConfig(siteConfig);
}

/**
 * Override site/feed channel metadata for this process.
 * Partial values are merged onto the Seed Protocol defaults (not the previous override set).
 */
export function setSiteConfig(overrides: SiteConfigOverrides): FeedConfig {
  siteConfig = resolveSiteConfig(overrides, DEFAULT_SITE_CONFIG);
  return getSiteConfig();
}

/** Restore hardcoded Seed Protocol site config defaults. */
export function resetSiteConfig(): void {
  siteConfig = cloneSiteConfig(DEFAULT_SITE_CONFIG);
}

/**
 * Load feed configuration from environment variables
 *
 * Environment variables:
 * - FEED_ITEM_URL_BASE: Base URL for attestation links (e.g. https://optimism-sepolia.easscan.org or https://easscan.org).
 *   When set, item links use {base}/attestation/view/{uid}. Default: 'https://easscan.org'. Set to override.
 * - FEED_ITEM_URL_PATH: Path segment for attestation links (default: 'attestation/view').
 *   Only used when FEED_ITEM_URL_BASE is set.
 * - FEED_SITE_URL: Site URL for fallback when FEED_ITEM_URL_BASE is unset (default: 'https://seedprotocol.io').
 * - FEED_EXPAND_RELATIONS: When 'false', relation properties stay as UIDs. Default: true (expand to nested objects).
 * - FEED_PAGE_SIZE: Items per page for paged feeds (default: 25).
 * - FEED_INCLUDE_DATA_URI_HTML_ITEMS: When 'true', include items whose body/html contain embedded data-URI images.
 *   Default: false (omit such items to avoid huge RSS payloads).
 */
export function loadFeedConfig(): {
  itemUrlBase: string;
  itemUrlPath: string;
  siteUrl: string;
  expandRelations: boolean;
  pageSize: number;
  richTextDataUriImages: 'omit_items' | 'include_items';
} {
  const itemUrlBase = process.env.FEED_ITEM_URL_BASE?.trim() || 'https://optimism-sepolia.easscan.org';
  const itemUrlPath =
    process.env.FEED_ITEM_URL_PATH?.trim() || 'attestation/view';
  const siteUrl =
    process.env.FEED_SITE_URL?.trim() || 'https://seedprotocol.io';
  const expandRelations = process.env.FEED_EXPAND_RELATIONS?.toLowerCase() !== 'false';
  const pageSize = parseInt(process.env.FEED_PAGE_SIZE || '25', 10);
  const richTextDataUriImages =
    process.env.FEED_INCLUDE_DATA_URI_HTML_ITEMS?.toLowerCase() === 'true'
      ? 'include_items'
      : 'omit_items';

  return { itemUrlBase, itemUrlPath, siteUrl, expandRelations, pageSize, richTextDataUriImages };
}
