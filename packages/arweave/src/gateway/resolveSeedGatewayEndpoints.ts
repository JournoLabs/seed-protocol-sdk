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

const SIDECAR_PROBE_TTL_MS = 3 * 60 * 1000

let sidecarProbeCache: { healthy: boolean; expiresAt: number } | null = null

/** Clears cached sidecar probe (tests / forced re-probe). */
export function invalidateSidecarProbeCache(): void {
  sidecarProbeCache = null
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

async function probeSidecarHealthy(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  const now = Date.now()
  if (sidecarProbeCache && now < sidecarProbeCache.expiresAt) {
    return sidecarProbeCache.healthy
  }

  const healthy = await probeGateway(baseUrl, signal)
  sidecarProbeCache = {
    healthy,
    expiresAt: now + SIDECAR_PROBE_TTL_MS,
  }
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

export type ResolveSeedGatewayEndpointsOptions = {
  signal?: AbortSignal
  /** Skip cache and probe sidecar again (hybrid). */
  forceSidecarProbe?: boolean
}

/**
 * Resolve effective gateway + upload API URLs for the configured transport mode.
 */
export async function resolveSeedGatewayEndpoints(
  config: SeedGatewayConfig,
  options?: ResolveSeedGatewayEndpointsOptions,
): Promise<ResolvedSeedGatewayEndpoints> {
  if (options?.forceSidecarProbe) {
    invalidateSidecarProbeCache()
  }

  const mode: SeedGatewayTransportMode = config.transport ?? 'http-gateway'

  if (mode === 'http-gateway') {
    return buildHttpEndpoints({ ...config, transport: mode })
  }

  if (mode === 'hyper') {
    const hyperEndpoints = buildHyperEndpoints(config)
    const shouldProbe = config.hyper?.probeSidecar !== false
    if (shouldProbe) {
      const ok = await probeSidecarHealthy(hyperEndpoints.arweaveBaseUrl, options?.signal)
      if (!ok) {
        throw new Error(
          `Gateway Hyper sidecar not reachable at ${hyperEndpoints.arweaveBaseUrl}. ` +
            'Run: seed gateway tunnel connect <operator-z32-key>',
        )
      }
    }
    return hyperEndpoints
  }

  // hybrid
  const sidecar = sidecarOrigin(config)
  const shouldProbe = config.hyper?.probeSidecar !== false
  if (shouldProbe && (await probeSidecarHealthy(sidecar.baseUrl, options?.signal))) {
    return buildHyperEndpoints({ ...config, transport: 'hyper' })
  }

  const http = buildHttpEndpoints({ ...config, transport: 'http-gateway' })
  return {
    ...http,
    mode: 'hybrid',
    activePath: 'hybrid-fallback-http',
  }
}

/** Build ordered gateway host list for read fallback (sidecar first in hybrid when active). */
export function getReadGatewayHostsForConfig(
  resolved: ResolvedSeedGatewayEndpoints,
  _defaults?: readonly string[],
): string[] {
  if (resolved.activePath === 'hyper-sidecar') {
    return [resolved.arweaveHost]
  }
  return getArweaveReadGatewayHostsForPrimary(resolved.arweaveHost)
}
