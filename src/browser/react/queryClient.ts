import {
  type QueryClient,
  type DefaultOptions,
  QueryClient as ReactQueryClient,
  type QueryClientConfig,
  NetworkMode,
} from '@tanstack/react-query'

const SEED_QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    networkMode: 'offlineFirst' as NetworkMode,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    staleTime: 1000 * 60, // 1 minute - list data can be slightly stale
  },
}

/**
 * Returns the default options used by Seed for list-query caching.
 * Use this when building your own QueryClient so Seed hooks get consistent behavior.
 */
export function getSeedQueryDefaultOptions(): DefaultOptions {
  return { ...SEED_QUERY_DEFAULT_OPTIONS }
}

/**
 * Merges Seed's default query options with your existing default options.
 * Your options take precedence over Seed's. Use when constructing your own QueryClient:
 *
 * @example
 * ```ts
 * const client = new QueryClient({
 *   defaultOptions: mergeSeedQueryDefaults({
 *     queries: { gcTime: 1000 * 60 * 60 },
 *   }),
 * })
 * ```
 */
export function mergeSeedQueryDefaults(
  userOptions?: Partial<DefaultOptions> | null
): DefaultOptions {
  const seed = getSeedQueryDefaultOptions()
  if (!userOptions) return seed
  return {
    queries: {
      ...seed.queries,
      ...(userOptions.queries ?? {}),
    },
    mutations: {
      ...(seed.mutations ?? {}),
      ...(userOptions.mutations ?? {}),
    },
  }
}

/**
 * Creates a QueryClient configured with Seed's default options.
 * Use this when you want to provide your own QueryClientProvider but still use Seed's defaults.
 *
 * @param overrides - Optional config to merge with Seed defaults (e.g. defaultOptions, logger).
 */
export function createSeedQueryClient(overrides?: Partial<QueryClientConfig>): QueryClient {
  const defaults = getSeedQueryDefaultOptions()
  const { defaultOptions: userDefaultOptions, ...restOverrides } = overrides ?? {}
  return new ReactQueryClient({
    ...restOverrides,
    defaultOptions: userDefaultOptions
      ? mergeSeedQueryDefaults(userDefaultOptions as DefaultOptions)
      : defaults,
  })
}
