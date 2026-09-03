import { probeGateway } from '../ArweaveClient/selectReadGateway.js'
import {
  DEFAULT_ARWEAVE_HOST,
  DEFAULT_GATEWAY_SIDECAR_HOST,
  DEFAULT_GATEWAY_SIDECAR_PORT,
  getArweaveReadGatewayHostsForPrimary,
} from '../constants.js'
import type {
  ResolvedSeedGatewayEndpoints,
  SeedGatewayConfig,
  SeedGatewayTransportMode,
} from '../types/gateway.js'

const PROBE_TTL_MS = 3 * 60 * 1000

let sidecarProbeCache: { healthy: boolean; expiresAt: number } | null = null
const proxyProbeCache = new Map<string, { healthy: boolean; expiresAt: number }>()

/** Clears cached sidecar / proxy probes (tests / forced re-probe). */
export function invalidateSidecarProbeCache(): void {
  sidecarProbeCache = null
  proxyProbeCache.clear()
}

function parseGatewayHost(input: string | undefined): { host: string; protocol: 'http' | 'https' } {
  const raw = (input ?? DEFAULT_ARWEAVE_HOST).trim()
  if (raw.startsWith('http://')) {
    return { protocol: 'http', host: raw.slice(7).replace(/\/$/, '') }
  }
  if (raw.startsWith('https://')) {
    return { protocol: 'https', host: raw.slice(8).replace(/\/$/, '') }
  }
  return { protocol: 'https', host: raw.replace(/\/$/, '') }
}

function sidecarOrigin(config: SeedGatewayConfig): {
  host: string
  port: number
  baseUrl: string
} {
  const host = config.hyper?.localSidecarHost?.trim() || DEFAULT_GATEWAY_SIDECAR_HOST
  const port = config.hyper?.localSidecarPort ?? DEFAULT_GATEWAY_SIDECAR_PORT
  const hostWithPort = port === 80 || port === 443 ? host : `${host}:${port}`
  return {
    host: hostWithPort,
    port,
    baseUrl: `http://${host}:${port}`,
  }
}

function browserOrigin(): string | undefined {
  try {
    const g = globalThis as { window?: { location?: { origin?: string } } }
    const origin = g.window?.location?.origin
    return typeof origin === 'string' && origin.length > 0 ? origin.replace(/\/$/, '') : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve `proxyBaseUrl` to an absolute origin+path (no trailing slash).
 * Relative paths require a browser `window.location.origin` or {@link ResolveSeedGatewayEndpointsOptions.origin}.
 */
export function resolveProxyBaseUrl(
  proxyBaseUrl: string,
  options?: { origin?: string },
): string {
  const raw = proxyBaseUrl.trim()
  if (!raw) {
    throw new Error('proxyBaseUrl is empty')
  }
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.replace(/\/$/, '')
  }
  if (raw.startsWith('/')) {
    const origin = (options?.origin?.trim() || browserOrigin() || '').replace(/\/$/, '')
    if (!origin) {
      throw new Error(
        `Relative proxyBaseUrl "${proxyBaseUrl}" requires a browser origin or resolve options.origin`,
      )
    }
    return `${origin}${raw.replace(/\/$/, '')}`
  }
  return `https://${raw.replace(/\/$/, '')}`
}

async function probeUrlHealthy(
  baseUrl: string,
  cacheKey: 'sidecar' | string,
  signal?: AbortSignal,
): Promise<boolean> {
  const now = Date.now()
  if (cacheKey === 'sidecar') {
    if (sidecarProbeCache && now < sidecarProbeCache.expiresAt) {
      return sidecarProbeCache.healthy
    }
    const healthy = await probeGateway(baseUrl, signal)
    sidecarProbeCache = { healthy, expiresAt: now + PROBE_TTL_MS }
    return healthy
  }

  const cached = proxyProbeCache.get(cacheKey)
  if (cached && now < cached.expiresAt) {
    return cached.healthy
  }
  const healthy = await probeGateway(baseUrl, signal)
  proxyProbeCache.set(cacheKey, { healthy, expiresAt: now + PROBE_TTL_MS })
  return healthy
}

function buildHttpEndpoints(config: SeedGatewayConfig): ResolvedSeedGatewayEndpoints {
  const { host, protocol } = parseGatewayHost(config.arweaveDomain)
  const baseUrl = `${protocol}://${host}`
  const uploadApiBaseUrl = config.uploadApiBaseUrl?.trim() || baseUrl
  return {
    mode: config.transport ?? 'http-gateway',
    arweaveHost: host,
    arweaveProtocol: protocol,
    arweaveBaseUrl: baseUrl,
    arweaveGraphqlUrl: `${protocol}://${host}/graphql`,
    uploadApiBaseUrl,
    activePath: 'http',
    gatewayHyperKey: config.hyper?.gatewayHyperKey?.trim() || undefined,
  }
}

function buildHyperEndpoints(config: SeedGatewayConfig): ResolvedSeedGatewayEndpoints {
  const sidecar = sidecarOrigin(config)
  const key = config.hyper?.gatewayHyperKey?.trim()
  return {
    mode: 'hyper',
    arweaveHost: sidecar.host,
    arweaveProtocol: 'http',
    arweaveBaseUrl: sidecar.baseUrl,
    arweaveGraphqlUrl: `${sidecar.baseUrl}/graphql`,
    uploadApiBaseUrl: sidecar.baseUrl,
    activePath: 'hyper-sidecar',
    gatewayHyperKey: key || undefined,
  }
}

function buildProxyEndpoints(
  config: SeedGatewayConfig,
  absoluteProxyBaseUrl: string,
): ResolvedSeedGatewayEndpoints {
  const parsed = new URL(absoluteProxyBaseUrl)
  const protocol: 'http' | 'https' = parsed.protocol === 'http:' ? 'http' : 'https'
  const path = parsed.pathname.replace(/\/$/, '')
  const hostWithPath = path ? `${parsed.host}${path}` : parsed.host
  const baseUrl = `${protocol}://${hostWithPath}`
  return {
    mode: config.transport ?? 'http-gateway',
    arweaveHost: hostWithPath,
    arweaveProtocol: protocol,
    arweaveBaseUrl: baseUrl,
    arweaveGraphqlUrl: `${baseUrl}/graphql`,
    uploadApiBaseUrl: baseUrl,
    activePath: 'http-proxy',
    gatewayHyperKey: config.hyper?.gatewayHyperKey?.trim() || undefined,
    proxyBaseUrl: absoluteProxyBaseUrl,
  }
}

export type ResolveSeedGatewayEndpointsOptions = {
  signal?: AbortSignal
  /** Skip cache and probe sidecar / proxy again. */
  forceSidecarProbe?: boolean
  /**
   * Origin used to resolve relative `proxyBaseUrl` (e.g. `https://app.example.com`).
   * Defaults to `window.location.origin` in browsers.
   */
  origin?: string
}

async function tryProxyEndpoints(
  config: SeedGatewayConfig,
  options?: ResolveSeedGatewayEndpointsOptions,
): Promise<ResolvedSeedGatewayEndpoints | null> {
  const raw = config.proxyBaseUrl?.trim()
  if (!raw) return null

  const absolute = resolveProxyBaseUrl(raw, { origin: options?.origin })
  const shouldProbe = config.hyper?.probeSidecar !== false
  if (shouldProbe) {
    const ok = await probeUrlHealthy(absolute, `proxy:${absolute}`, options?.signal)
    if (!ok) return null
  }
  return buildProxyEndpoints(config, absolute)
}

/**
 * Resolve effective gateway + upload API URLs for the configured transport mode.
 *
 * Preference when a proxy and/or sidecar may apply:
 * configured + healthy `proxyBaseUrl` → local Hyper sidecar → public HTTP gateway.
 */
export async function resolveSeedGatewayEndpoints(
  config: SeedGatewayConfig,
  options?: ResolveSeedGatewayEndpointsOptions,
): Promise<ResolvedSeedGatewayEndpoints> {
  if (options?.forceSidecarProbe) {
    invalidateSidecarProbeCache()
  }

  const mode: SeedGatewayTransportMode = config.transport ?? 'http-gateway'
  const shouldProbe = config.hyper?.probeSidecar !== false

  if (mode === 'http-gateway') {
    if (config.proxyBaseUrl?.trim()) {
      const absolute = resolveProxyBaseUrl(config.proxyBaseUrl, { origin: options?.origin })
      if (shouldProbe) {
        const ok = await probeUrlHealthy(absolute, `proxy:${absolute}`, options?.signal)
        if (!ok) {
          throw new Error(
            `Gateway HTTP proxy not reachable at ${absolute}. ` +
              'Ensure your Node route runs createGatewayProxy (or equivalent) and mounts at proxyBaseUrl.',
          )
        }
      }
      return buildProxyEndpoints({ ...config, transport: mode }, absolute)
    }
    return buildHttpEndpoints({ ...config, transport: mode })
  }

  if (mode === 'hyper') {
    const proxy = await tryProxyEndpoints({ ...config, transport: mode }, options)
    if (proxy) return proxy

    const hyperEndpoints = buildHyperEndpoints({ ...config, transport: mode })
    if (shouldProbe) {
      const ok = await probeUrlHealthy(hyperEndpoints.arweaveBaseUrl, 'sidecar', options?.signal)
      if (!ok) {
        throw new Error(
          `Gateway Hyper sidecar not reachable at ${hyperEndpoints.arweaveBaseUrl}. ` +
            'Run: seed gateway tunnel connect <operator-z32-key> — or configure gateway.proxyBaseUrl for an app-server proxy.',
        )
      }
    }
    return hyperEndpoints
  }

  // hybrid: proxy → sidecar → public HTTP
  const proxy = await tryProxyEndpoints({ ...config, transport: mode }, options)
  if (proxy) return proxy

  const sidecar = sidecarOrigin(config)
  if (shouldProbe && (await probeUrlHealthy(sidecar.baseUrl, 'sidecar', options?.signal))) {
    return buildHyperEndpoints({ ...config, transport: 'hyper' })
  }

  const http = buildHttpEndpoints({ ...config, transport: 'http-gateway' })
  return {
    ...http,
    mode: 'hybrid',
    activePath: 'hybrid-fallback-http',
  }
}

/** Build ordered gateway host list for read fallback (sidecar/proxy first when active). */
export function getReadGatewayHostsForConfig(
  resolved: ResolvedSeedGatewayEndpoints,
  _defaults?: readonly string[],
): string[] {
  if (resolved.activePath === 'hyper-sidecar' || resolved.activePath === 'http-proxy') {
    return [resolved.arweaveHost]
  }
  return getArweaveReadGatewayHostsForPrimary(resolved.arweaveHost)
}
