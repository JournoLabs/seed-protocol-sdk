import debug from 'debug'

/** Per-request feed logs (cache hits and misses, item counts, image probes) under `DEBUG=seedFeed`. */
export const feedDebug = debug('seedFeed')
