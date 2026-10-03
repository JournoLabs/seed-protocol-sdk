import type { ResolvedSeedGatewayEndpoints } from '../types/gateway.js'
import { resolveProxyBaseUrl } from './resolveSeedGatewayEndpoints.js'

let resolvedGatewayEndpoints: ResolvedSeedGatewayEndpoints | null = null

/** Last endpoints applied during client init (for read-path helpers). */
export function getResolvedSeedGatewayEndpoints(): ResolvedSeedGatewayEndpoints | null {
  return resolvedGatewayEndpoints
}

export function setResolvedSeedGatewayEndpoints(
  value: ResolvedSeedGatewayEndpoints | null,
): void {
  resolvedGatewayEndpoints = value
}

let preferredReadBaseUrls: string[] = []

/**
 * Gateways tried before the resolved / public hosts for `/raw/{id}` reads — typically the gateway
 * the app uploads through (Hyper sidecar or app-server proxy), which serves data items before they
 * reach L1 or the public gateways. Does not affect upload, GraphQL or {@link BaseArweaveClient} host.
 */
export function getPreferredArweaveReadBaseUrls(): string[] {
  return preferredReadBaseUrls
}

/**
 * Replace the preferred read gateways. Each entry is a base URL with scheme and any path prefix
 * (`https://app.example.com/api/seed-gateway`); same-origin relative paths (`/api/seed-gateway`)
 * resolve against `window.location.origin` and are dropped when there is no origin. Pass `[]` to clear.
 */
export function setPreferredArweaveReadBaseUrls(urls: readonly string[]): void {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of urls) {
    const trimmed = raw?.trim()
    if (!trimmed) continue
    let url: string
    try {
      // URL lowercases scheme and host; the path stays case-sensitive.
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : resolveProxyBaseUrl(trimmed))
      url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
    } catch {
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  preferredReadBaseUrls = out
}
