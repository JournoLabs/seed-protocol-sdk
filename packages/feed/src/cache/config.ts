import { DEFAULT_ARWEAVE_GATEWAYS } from '@seedprotocol/sdk'
import type { CacheConfig, ImageMetadataConfig } from './types';

/**
 * Load cache configuration from environment variables
 *
 * Environment variables:
 * - CACHE_ENABLED: Set to 'false' to disable caching. Set to 'true' to enable (overrides NODE_ENV).
 *   In development (NODE_ENV=development), cache is disabled by default unless CACHE_ENABLED='true'.
 * - CACHE_TTL: Cache time-to-live in seconds (default: 3600)
 * - CACHE_DIR: Directory for cache files (default: './cache')
 * - CACHE_BACKGROUND_REFRESH: Enable background refresh (default: 'false')
 * - CACHE_REFRESH_INTERVAL: Background refresh interval in seconds (default: 300)
 */
export function loadCacheConfig(): CacheConfig {
  const ttl = parseInt(process.env.CACHE_TTL || '3600', 10);
  const cacheDir = process.env.CACHE_DIR || './cache';

  // CACHE_ENABLED explicitly disables: 'false', '0', 'no', 'off'
  const cacheDisabledByEnvVar =
    process.env.CACHE_ENABLED === 'false' ||
    process.env.CACHE_ENABLED === '0' ||
    process.env.CACHE_ENABLED === 'no' ||
    process.env.CACHE_ENABLED === 'off';
  // CACHE_ENABLED explicitly enables (overrides NODE_ENV=development)
  const cacheEnabledByEnvVar =
    process.env.CACHE_ENABLED === 'true' ||
    process.env.CACHE_ENABLED === '1' ||
    process.env.CACHE_ENABLED === 'yes';
  const isDev = process.env.NODE_ENV === 'development';

  let enabled: boolean;
  if (cacheDisabledByEnvVar) {
    enabled = false;
  } else if (cacheEnabledByEnvVar) {
    enabled = true;
  } else if (isDev) {
    enabled = false; // Disable cache in dev mode by default
  } else {
    enabled = true;
  }

  const backgroundRefresh = process.env.CACHE_BACKGROUND_REFRESH === 'true';
  const refreshInterval = parseInt(
    process.env.CACHE_REFRESH_INTERVAL || '300',
    10
  );

  // Log cache status on startup
  if (!enabled) {
    const reason = cacheDisabledByEnvVar
      ? 'CACHE_ENABLED=false'
      : isDev
        ? 'NODE_ENV=development'
        : 'CACHE_ENABLED=false';
    console.log(`⚠️  Cache is DISABLED (${reason})`);
  }

  // Image metadata configuration
  const imageMetadataEnabled = process.env.IMAGE_METADATA_ENABLED !== 'false'; // Default to true
  const imageMetadataTtl = parseInt(process.env.IMAGE_METADATA_TTL || '604800', 10); // 7 days default
  const imageMetadataGateways = process.env.IMAGE_METADATA_GATEWAYS
    ? process.env.IMAGE_METADATA_GATEWAYS.split(',').map(g => g.trim())
    : [...DEFAULT_ARWEAVE_GATEWAYS];
  const imageMetadataTimeout = parseInt(process.env.IMAGE_METADATA_TIMEOUT || '5000', 10);

  const imageMetadata: ImageMetadataConfig = {
    enabled: imageMetadataEnabled,
    ttl: imageMetadataTtl,
    gateways: imageMetadataGateways,
    timeout: imageMetadataTimeout,
  };

  const pageTtl = parseInt(process.env.CACHE_PAGE_TTL || '300', 10);
  const archiveTtl = parseInt(process.env.CACHE_ARCHIVE_TTL || '86400', 10);

  return {
    ttl,
    cacheDir,
    enabled,
    backgroundRefresh,
    refreshInterval,
    imageMetadata,
    pageTtl,
    archiveTtl,
  };
}
