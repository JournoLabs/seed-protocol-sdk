/**
 * Load feed configuration from environment variables
 *
 * Environment variables:
 * - FEED_ITEM_URL_BASE: Base URL for attestation links (e.g. https://optimism-sepolia.easscan.org or https://easscan.org).
 *   When set, item links use {base}/attestation/view/{uid}. Default: 'https://easscan.org'. Set to override.
 * - FEED_ITEM_URL_PATH: Path segment for attestation links (default: 'attestation/view').
 *   Only used when FEED_ITEM_URL_BASE is set.
 * - FEED_SITE_URL: Site URL for fallback when FEED_ITEM_URL_BASE is unset (default: 'https://seedprotocol.io').
 */
export function loadFeedConfig(): {
  itemUrlBase: string;
  itemUrlPath: string;
  siteUrl: string;
} {
  const itemUrlBase = process.env.FEED_ITEM_URL_BASE?.trim() || 'https://optimism-sepolia.easscan.org';
  const itemUrlPath =
    process.env.FEED_ITEM_URL_PATH?.trim() || 'attestation/view';
  const siteUrl =
    process.env.FEED_SITE_URL?.trim() || 'https://seedprotocol.io';

  return { itemUrlBase, itemUrlPath, siteUrl };
}
