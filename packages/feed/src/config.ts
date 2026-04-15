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
