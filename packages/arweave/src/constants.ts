/** Default Arweave gateway host used across all packages (first in {@link DEFAULT_ARWEAVE_GATEWAYS}) */
export const DEFAULT_ARWEAVE_HOST = 'ar.seedprotocol.io'

/**
 * Official Seed Protocol public feed Hyperdrive key (z32).
 * Empty until the first official publisher keypair is generated and backed up by ops.
 */
export const DEFAULT_SEED_FEED_HYPER_KEY = ''

/**
 * Official Seed Protocol gateway Hyper tunnel operator key (z32).
 * Empty until ops generate and back up the first operator keypair.
 */
export const DEFAULT_SEED_GATEWAY_HYPER_KEY = ''

/** Default localhost sidecar bind for Gateway Hyper client mode. */
export const DEFAULT_GATEWAY_SIDECAR_HOST = '127.0.0.1'
export const DEFAULT_GATEWAY_SIDECAR_PORT = 1984

/** Default Arweave gateway GraphQL endpoint (transaction / block queries). */
export const DEFAULT_ARWEAVE_GRAPHQL_URL = `https://${DEFAULT_ARWEAVE_HOST}/graphql`

/**
 * Default Arweave gateways for read fallback / metadata fetching (ordered by preference).
 * Override order with `ARWEAVE_READ_GATEWAYS` or `NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS` (comma-separated hosts).
 */
export const DEFAULT_ARWEAVE_GATEWAYS = [
  'ar.seedprotocol.io',
  'arweave.net',
  'arweave.dev',
  'g8way.io',
  'permagate.io',
  'zigza.xyz',
] as const

const READ_GATEWAYS_ENV_KEYS = ['ARWEAVE_READ_GATEWAYS', 'NEXT_PUBLIC_ARWEAVE_READ_GATEWAYS'] as const

/** Ordered gateway hostnames for reads: env list if set, otherwise {@link DEFAULT_ARWEAVE_GATEWAYS}. */
export function getDefaultArweaveReadGatewayHostsOrdered(): string[] {
  if (typeof process === 'undefined' || !process.env) {
    return [...DEFAULT_ARWEAVE_GATEWAYS]
  }
  for (const key of READ_GATEWAYS_ENV_KEYS) {
    const raw = process.env[key]?.trim()
    if (raw) {
      return raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return [...DEFAULT_ARWEAVE_GATEWAYS]
}

/**
 * Deduped host list: primary first, then each default not already present (case-insensitive).
 */
export function mergePrimaryHostWithDefaults(
  primary: string,
  defaults: readonly string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const keyOf = (h: string) => h.trim().toLowerCase().replace(/\/$/, '')
  const add = (h: string) => {
    const t = h.trim().replace(/\/$/, '')
    if (!t) return
    const k = keyOf(t)
    if (seen.has(k)) return
    seen.add(k)
    out.push(t)
  }
  add(primary)
  for (const d of defaults) add(d)
  return out
}

/**
 * True if `hostname` looks like a public Arweave gateway used in stored URLs (hydration / RSS).
 */
export function isKnownArweaveGatewayHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  if (!h) return false
  if (h.endsWith('arweave.net')) return true
  if (h.endsWith('ar-io.net')) return true
  for (const g of DEFAULT_ARWEAVE_GATEWAYS) {
    const gl = g.toLowerCase()
    if (h === gl || h.endsWith(`.${gl}`)) return true
  }
  return false
}
