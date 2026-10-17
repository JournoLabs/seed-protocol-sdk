import type { Endpoints, SeedConfig } from '@/types'

/** `filesDir` when the config sets neither it nor `endpoints.files`. */
export const DEFAULT_FILES_DIR = '.seed'

/**
 * Fills `filesDir` and `endpoints` so `client.init` can be called with neither. `filesDir` falls
 * back to `endpoints.files`, then to {@link DEFAULT_FILES_DIR}. The endpoint labels have no consumer
 * besides that fallback and the copy saved in `app_state`, so missing ones take `filesDir`.
 */
export function applySeedConfigDefaults(config: SeedConfig | undefined): SeedConfig | undefined {
  if (!config) return config
  const endpoints = config.endpoints
  if (endpoints?.filePaths && endpoints?.files) return config
  const filesDir = config.filesDir || endpoints?.files || DEFAULT_FILES_DIR
  const next: Endpoints = {
    filePaths: endpoints?.filePaths || filesDir,
    files: endpoints?.files || filesDir,
  }
  return { ...config, filesDir, endpoints: next }
}
