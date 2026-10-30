import { BaseArweaveClient } from './BaseArweaveClient.js'
import {
  DEFAULT_ARWEAVE_HOST,
  getArweaveReadGatewayHostsForPrimary,
} from '../constants.js'
import {
  beginGatewayHostHalfOpenProbe,
  cancelGatewayHostHalfOpenProbe,
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

export type ProbeGatewayOptions = {
  /** Aborts the probe. A probe the caller aborts resolves false and isn't counted as a failure. */
  signal?: AbortSignal
  /** Gives up (and counts a failure) after this long, with or without `signal`. Default 5 s. */
  timeoutMs?: number
  /**
   * Record the result in the gateway circuit breaker, and skip a host whose circuit is open.
   * Default true. Pass false for a status check that shouldn't change which gateways reads use.
   */
  recordCircuit?: boolean
}

/** GET /info. Healthy when it answers 2xx with a JSON object. */
export async function probeGateway(
  baseUrl: string,
  options: ProbeGatewayOptions = {},
): Promise<boolean> {
  if (options instanceof AbortSignal) {
    throw new TypeError('probeGateway takes options: pass { signal }, not an AbortSignal')
  }
  const { signal, timeoutMs = PROBE_TIMEOUT_MS, recordCircuit = true } = options
  const url = `${baseUrl.replace(/\/$/, '')}/info`
  let hostKey = baseUrl
  try {
    hostKey = new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).host
  } catch {
    hostKey = baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }

  if (recordCircuit) {
    if (isGatewayHostCircuitOpen(hostKey)) return false
    beginGatewayHostHalfOpenProbe(hostKey)
  }
  const record = (healthy: boolean): boolean => {
    if (recordCircuit) {
      if (healthy) recordGatewayHostSuccess(hostKey)
      else recordGatewayHostFailure(hostKey)
    }
    return healthy
  }
  const callerAborted = (): boolean => {
    if (recordCircuit) cancelGatewayHostHalfOpenProbe(hostKey)
    return false
  }
  if (signal?.aborted) return callerAborted()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return record(false)
    const text = await response.text()
    if (!text.trim()) return record(false)
    try {
      const json = JSON.parse(text) as unknown
      return record(typeof json === 'object' && json !== null)
    } catch {
      return record(false)
    }
  } catch {
    if (signal?.aborted) return callerAborted()
    return record(false)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
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
    if (await probeGateway(baseUrl, { signal })) {
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
 * `healthy: false` so {@link isReadGatewayKnownHealthy} reflects that. When `signal` aborts before a
 * host passes, nothing is cached and it returns the last healthy host (else the current one).
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

    // An aborted probe says nothing about the gateways: keep the cache and host as they were.
    if (!picked && signal?.aborted) {
      return lastHealthyReadGatewayHost ?? BaseArweaveClient.getHost()
    }

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
