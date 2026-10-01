import { isBrowser, isNode } from '@/helpers/environment'
import type { Endpoints, SeedConfig } from '@/types'

/**
 * On Node, storage uses `filesDir`. `endpoints.filePaths` and `endpoints.files` are
 * required by init but have no separate Node consumer, so fill them from `filesDir`.
 * Browser configs are left unchanged.
 */
export function normalizeSeedConfigEndpoints(config: SeedConfig | undefined): SeedConfig | undefined {
  if (!config) return config
  const endpoints = config.endpoints
  if (endpoints?.filePaths && endpoints?.files) return config
  if (!(isNode() && !isBrowser())) return config
  const filesDir = config.filesDir
  if (!filesDir) return config
  const next: Endpoints = {
    filePaths: endpoints?.filePaths || filesDir,
    files: endpoints?.files || filesDir,
  }
  return { ...config, endpoints: next }
}
