/**
 * Settings shared by the Seed bundler integrations (@seedprotocol/vite, @seedprotocol/next).
 * Each package inlines this module at build time, so keep it dependency-free.
 */

/** Node `fs` specifiers the browser build aliases to ZenFS. */
export const DEFAULT_FS_MODULES: readonly string[] = ['fs', 'fs/promises', 'node:fs', 'node:fs/promises']

/** The ZenFS module an aliased `fs` specifier resolves to. */
export function zenfsModuleFor(fsModule: string): '@zenfs/core' | '@zenfs/core/promises' {
  return fsModule.includes('promises') ? '@zenfs/core/promises' : '@zenfs/core'
}

/** Cross-origin isolation headers SQLite WASM, SharedArrayBuffer and OPFS need. */
export const DEFAULT_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const

/** The `isolationHeaders` option both integrations accept. */
export type IsolationHeadersOption =
  | boolean
  | {
      coop?: string
      coep?: string
      corp?: string
    }

/** Header name to value, or `null` when the option disables the headers. */
export function resolveIsolationHeaders(
  option: IsolationHeadersOption | undefined,
): Record<string, string> | null {
  if (option === false) return null
  const overrides = typeof option === 'object' && option ? option : {}
  return {
    'Cross-Origin-Opener-Policy': overrides.coop ?? DEFAULT_ISOLATION_HEADERS['Cross-Origin-Opener-Policy'],
    'Cross-Origin-Embedder-Policy': overrides.coep ?? DEFAULT_ISOLATION_HEADERS['Cross-Origin-Embedder-Policy'],
    'Cross-Origin-Resource-Policy': overrides.corp ?? DEFAULT_ISOLATION_HEADERS['Cross-Origin-Resource-Policy'],
  }
}

/**
 * Isolation headers the user has not set in `headers` (case-insensitive), so an
 * integration can add them without replacing the user's values.
 */
export function isolationHeadersNotSetBy(
  isolationHeaders: Record<string, string>,
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const userKeys = new Set(Object.keys(headers ?? {}).map((key) => key.toLowerCase()))
  return Object.fromEntries(
    Object.entries(isolationHeaders).filter(([key]) => !userKeys.has(key.toLowerCase())),
  )
}

/**
 * The isolation headers to send: the user's `headers` value where they set one, else ours.
 */
export function effectiveIsolationHeaders(
  isolationHeaders: Record<string, string>,
  headers: Record<string, unknown> | undefined,
): Record<string, string> {
  const userValues = new Map(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return Object.fromEntries(
    Object.entries(isolationHeaders).map(([key, value]) => {
      const userValue = userValues.get(key.toLowerCase())
      return [key, userValue == null ? value : String(userValue)]
    }),
  )
}
