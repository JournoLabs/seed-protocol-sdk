import { BaseArweaveClient } from './BaseArweaveClient.js'
import {
  DEFAULT_ARWEAVE_HOST,
  getArweaveReadGatewayHostsForPrimary,
} from '../constants.js'
import {
  beginGatewayHostHalfOpenProbe,
  isGatewayHostCircuitOpen,
  recordGatewayHostFailure,
  recordGatewayHostSuccess,
  resetGatewayCircuitBreakerForTests,
} from '../gateway/gatewayCircuitBreaker.js'

const READ_GATEWAY_CACHE_TTL_MS = 3 * 60 * 1000
/** Shorter TTL when no gateway passed the probe — avoid hammering while still recovering sooner. */
const READ_GATEWAY_UNHEALTHY_CACHE_TTL_MS = 60 * 1000
const PROBE_TIMEOUT_MS = 5000

type ReadGatewayCache = {
  host: string
  /** False when the last probe found no healthy gateway. */
  healthy: boolean
  expiresAt: number
}

let readGatewayCache: ReadGatewayCache | null = null
let ensureInFlight: Promise<string> | null = null
/** Last host that successfully passed /info (survives an all-fail probe cycle). */
let lastHealthyReadGatewayHost: string | null = null

/** Clears cached read gateway (e.g. after tests or to force a fresh probe). */
export function invalidateReadGatewayCache(): void {
  readGatewayCache = null
  ensureInFlight = null
}

/** Clears probe cache, env override suppression, and preferred host (for tests). */
export function resetArweaveReadGatewayForTests(): void {
  invalidateReadGatewayCache()
  lastHealthyReadGatewayHost = null
  resetGatewayCircuitBreakerForTests()
  BaseArweaveClient.resetReadGatewaySelectionStateForTests()
  if (!BaseArweaveClient.isReadGatewayLocked()) {
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
  }
}

/**
 * True when the last {@link ensureReadGatewaySelected} probe found a healthy host
 * (or the cache still says so). False after an all-fail probe until the next success.
 */
export function isReadGatewayKnownHealthy(): boolean {
  if (BaseArweaveClient.isReadGatewayLocked()) return true
  if (readGatewayCache && Date.now() < readGatewayCache.expiresAt) {
    return readGatewayCache.healthy
  }
  return lastHealthyReadGatewayHost != null
}

/** Last gateway host that passed /info, if any. */
export function getLastHealthyReadGatewayHost(): string | null {
  return lastHealthyReadGatewayHost
}

/**
 * GET /info with timeout. Treat 2xx + JSON object as healthy.
 * Records circuit-breaker success/failure for the host.
 */
export async function probeGateway(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/info`
  let hostKey = baseUrl
  try {
    hostKey = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).host
  } catch {
    hostKey = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }

  if (isGatewayHostCircuitOpen(hostKey)) {
    return false
  }
  beginGatewayHostHalfOpenProbe(hostKey)

  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  const effectiveSignal = signal ?? controller.signal
  if (!signal) {
    timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  }
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: effectiveSignal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      recordGatewayHostFailure(hostKey)
      return false
    }
    const text = await response.text()
    if (!text.trim()) {
      recordGatewayHostFailure(hostKey)
      return false
    }
    try {
      const json = JSON.parse(text) as unknown
      const ok = typeof json === 'object' && json !== null
      if (ok) recordGatewayHostSuccess(hostKey)
      else recordGatewayHostFailure(hostKey)
      return ok
    } catch {
      recordGatewayHostFailure(hostKey)
      return false
    }
  } catch {
    recordGatewayHostFailure(hostKey)
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function selectFirstHealthyReadGateway(
  hosts: string[],
  protocol: 'http' | 'https' = 'https',
  signal?: AbortSignal,
): Promise<string | null> {
  for (const host of hosts) {
    const h = host.trim().replace(/\/$/, '')
    if (!h) continue
    if (isGatewayHostCircuitOpen(h)) continue
    const baseUrl = `${protocol}://${h}`
    if (await probeGateway(baseUrl, signal)) {
      return h
    }
  }
  return null
}

function buildOrderedHostsForProbe(): string[] {
  return getArweaveReadGatewayHostsForPrimary(BaseArweaveClient.getHost())
}

/**
 * Probes gateways in order and applies the first healthy host via {@link BaseArweaveClient.applyProbedReadGateway}.
 * No-op when the read gateway is locked ({@link BaseArweaveClient.setHost}).
 * Uses a short TTL cache to avoid probing on every read.
 *
 * When every probe fails, keeps the last known healthy host (if any) instead of
 * treating the preferred-but-unreachable host as selected, and caches
 * `healthy: false` so {@link isReadGatewayKnownHealthy} reflects that.
 */
export async function ensureReadGatewaySelected(signal?: AbortSignal): Promise<string> {
  if (BaseArweaveClient.isReadGatewayLocked()) {
    return BaseArweaveClient.getHost()
  }

  const now = Date.now()
  if (readGatewayCache && now < readGatewayCache.expiresAt) {
    return readGatewayCache.host
  }

  if (ensureInFlight) {
    return ensureInFlight
  }

  ensureInFlight = (async () => {
    const ordered = buildOrderedHostsForProbe()
    const protocol = BaseArweaveClient.getProtocol()
    const picked = await selectFirstHealthyReadGateway(ordered, protocol, signal)

    if (!BaseArweaveClient.isReadGatewayLocked()) {
      if (picked) {
        BaseArweaveClient.applyProbedReadGateway(picked)
        lastHealthyReadGatewayHost = picked
        readGatewayCache = {
          host: picked,
          healthy: true,
          expiresAt: Date.now() + READ_GATEWAY_CACHE_TTL_MS,
        }
      } else {
        const fallback = lastHealthyReadGatewayHost ?? BaseArweaveClient.getHost()
        if (
          lastHealthyReadGatewayHost &&
          BaseArweaveClient.getHost() !== lastHealthyReadGatewayHost
        ) {
          BaseArweaveClient.applyProbedReadGateway(lastHealthyReadGatewayHost)
        }
        readGatewayCache = {
          host: fallback,
          healthy: false,
          expiresAt: Date.now() + READ_GATEWAY_UNHEALTHY_CACHE_TTL_MS,
        }
      }
    } else {
      readGatewayCache = {
        host: BaseArweaveClient.getHost(),
        healthy: true,
        expiresAt: Date.now() + READ_GATEWAY_CACHE_TTL_MS,
      }
    }

    return readGatewayCache.host
  })()

  try {
    return await ensureInFlight
  } finally {
    ensureInFlight = null
  }
}
