import type { QuerySourceMode } from '../types.js'
import { getRegisteredLocalQuerySource } from './registry.js'
import { getRemoteQueryDataSource } from './remote.js'
import type { QueryDataSource } from './types.js'

export type ResolvedQuerySource = {
  mode: QuerySourceMode
  dataSource: QueryDataSource
  /** True when CacheManager may be used for this call. */
  useQueryCache: boolean
}

/**
 * Resolve which data source to use for a call.
 * - remote (default): EAS
 * - local: registered adapter or throw
 * - auto: prefer local when registered; else remote (caller may still fall back per-seed)
 */
export function resolveQuerySource(
  mode: QuerySourceMode = 'remote',
): ResolvedQuerySource {
  if (mode === 'remote') {
    return {
      mode: 'remote',
      dataSource: getRemoteQueryDataSource(),
      useQueryCache: true,
    }
  }

  const local = getRegisteredLocalQuerySource()

  if (mode === 'local') {
    if (!local) {
      throw new Error(
        '[query] source: "local" requires registerLocalQuerySource(...) (e.g. SDK DB ready)',
      )
    }
    return {
      mode: 'local',
      dataSource: local,
      useQueryCache: false,
    }
  }

  // auto
  if (local) {
    return {
      mode: 'auto',
      dataSource: local,
      useQueryCache: false,
    }
  }
  return {
    mode: 'auto',
    dataSource: getRemoteQueryDataSource(),
    useQueryCache: true,
  }
}

export function normalizeSourceMode(
  source?: QuerySourceMode,
): QuerySourceMode {
  return source ?? 'remote'
}
