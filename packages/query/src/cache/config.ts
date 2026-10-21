import type { QueryCacheConfig } from './types.js'

function env(): Record<string, string | undefined> {
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env
  return processEnv ?? {}
}

/**
 * Load query cache configuration from environment variables.
 *
 * Uses the same CACHE_* vars as feed for ops compatibility:
 * - CACHE_ENABLED
 * - CACHE_TTL (default 3600)
 * - CACHE_DIR (default ./cache)
 * - CACHE_MAX_AGE (default 0): seconds a checked collection is served without a request
 *
 * In development (NODE_ENV=development), cache is disabled unless
 * CACHE_ENABLED is explicitly true.
 *
 * Records are deep-frozen as they enter the memory cache unless NODE_ENV=production
 * (see {@link defaultFreezeRecords}).
 */
/**
 * Cached records are handed to callers by reference, so a caller that mutates one corrupts the
 * cache. Outside production they are frozen when cached so such a write throws (in strict mode)
 * instead; production skips the walk.
 */
export function defaultFreezeRecords(): boolean {
  return env().NODE_ENV !== 'production'
}

export function loadQueryCacheConfig(): QueryCacheConfig {
  const e = env()
  const ttl = parseInt(e.CACHE_TTL || '3600', 10)
  const cacheDir = e.CACHE_DIR || './cache'

  const cacheDisabledByEnvVar =
    e.CACHE_ENABLED === 'false' ||
    e.CACHE_ENABLED === '0' ||
    e.CACHE_ENABLED === 'no' ||
    e.CACHE_ENABLED === 'off'
  const cacheEnabledByEnvVar =
    e.CACHE_ENABLED === 'true' ||
    e.CACHE_ENABLED === '1' ||
    e.CACHE_ENABLED === 'yes'
  const isDev = e.NODE_ENV === 'development'

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

  const maxAge = Math.max(0, parseInt(e.CACHE_MAX_AGE || '0', 10) || 0)

  return {
    ttl,
    cacheDir,
    enabled,
    maxAge,
    freezeRecords: defaultFreezeRecords(),
  }
}
