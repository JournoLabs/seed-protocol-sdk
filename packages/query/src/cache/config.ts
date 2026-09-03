import type { QueryCacheConfig } from './types.js'

/**
 * Load query cache configuration from environment variables.
 *
 * Uses the same CACHE_* vars as feed for ops compatibility:
 * - CACHE_ENABLED
 * - CACHE_TTL (default 3600)
 * - CACHE_DIR (default ./cache)
 * - CACHE_BACKGROUND_REFRESH / CACHE_REFRESH_INTERVAL (unused stubs)
 *
 * In development (NODE_ENV=development), cache is disabled unless
 * CACHE_ENABLED is explicitly true.
 */
export function loadQueryCacheConfig(): QueryCacheConfig {
  const ttl = parseInt(process.env.CACHE_TTL || '3600', 10)
  const cacheDir = process.env.CACHE_DIR || './cache'

  const cacheDisabledByEnvVar =
    process.env.CACHE_ENABLED === 'false' ||
    process.env.CACHE_ENABLED === '0' ||
    process.env.CACHE_ENABLED === 'no' ||
    process.env.CACHE_ENABLED === 'off'
  const cacheEnabledByEnvVar =
    process.env.CACHE_ENABLED === 'true' ||
    process.env.CACHE_ENABLED === '1' ||
    process.env.CACHE_ENABLED === 'yes'
  const isDev = process.env.NODE_ENV === 'development'

  let enabled: boolean
  if (cacheDisabledByEnvVar) {
    enabled = false
  } else if (cacheEnabledByEnvVar) {
    enabled = true
  } else if (isDev) {
    enabled = false
  } else {
    enabled = true
  }

  const backgroundRefresh = process.env.CACHE_BACKGROUND_REFRESH === 'true'
  const refreshInterval = parseInt(
    process.env.CACHE_REFRESH_INTERVAL || '300',
    10,
  )

  return {
    ttl,
    cacheDir,
    enabled,
    backgroundRefresh,
    refreshInterval,
  }
}
