import type { CacheConfig, ImageMetadataConfig } from './types';

/**
 * Load cache configuration from environment variables
 * 
 * Environment variables:
 * - CACHE_ENABLED: Set to 'false' to disable caching (default: 'true')
 * - CACHE_TTL: Cache time-to-live in seconds (default: 3600)
 * - CACHE_DIR: Directory for cache files (default: './cache')
 * - CACHE_BACKGROUND_REFRESH: Enable background refresh (default: 'false')
 * - CACHE_REFRESH_INTERVAL: Background refresh interval in seconds (default: 300)
 */
export function loadCacheConfig(): CacheConfig {
  const ttl = parseInt(process.env.CACHE_TTL || '3600', 10);
  const cacheDir = process.env.CACHE_DIR || './cache';
  // CACHE_ENABLED can be 'false', '0', 'no', or any falsy value to disable
  const enabled = !(
    process.env.CACHE_ENABLED === 'false' ||
    process.env.CACHE_ENABLED === '0' ||
    process.env.CACHE_ENABLED === 'no' ||
    process.env.CACHE_ENABLED === 'off'
  );
  const backgroundRefresh = process.env.CACHE_BACKGROUND_REFRESH === 'true';
  const refreshInterval = parseInt(
    process.env.CACHE_REFRESH_INTERVAL || '300',
    10
  );
  
  // Log cache status on startup
  if (!enabled) {
    console.log('⚠️  Cache is DISABLED (CACHE_ENABLED=false)');
  }

  // Image metadata configuration
  const imageMetadataEnabled = process.env.IMAGE_METADATA_ENABLED !== 'false'; // Default to true
  const imageMetadataTtl = parseInt(process.env.IMAGE_METADATA_TTL || '604800', 10); // 7 days default
  const imageMetadataGateways = process.env.IMAGE_METADATA_GATEWAYS
    ? process.env.IMAGE_METADATA_GATEWAYS.split(',').map(g => g.trim())
    : ['arweave.net', 'ar-io.net'];
  const imageMetadataTimeout = parseInt(process.env.IMAGE_METADATA_TIMEOUT || '5000', 10);

  const imageMetadata: ImageMetadataConfig = {
    enabled: imageMetadataEnabled,
    ttl: imageMetadataTtl,
    gateways: imageMetadataGateways,
    timeout: imageMetadataTimeout,
  };

  return {
    ttl,
    cacheDir,
    enabled,
    backgroundRefresh,
    refreshInterval,
    imageMetadata,
  };
}
