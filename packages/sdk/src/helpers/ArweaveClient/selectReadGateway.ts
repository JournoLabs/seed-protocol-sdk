import { BaseArweaveClient } from './BaseArweaveClient'
import {
  DEFAULT_ARWEAVE_HOST,
  getDefaultArweaveReadGatewayHostsOrdered,
  mergePrimaryHostWithDefaults,
} from '@/helpers/constants'

const READ_GATEWAY_CACHE_TTL_MS = 3 * 60 * 1000
const PROBE_TIMEOUT_MS = 5000

let readGatewayCache: { host: string; expiresAt: number } | null = null
let ensureInFlight: Promise<string> | null = null

/** Clears cached read gateway (e.g. after tests or to force a fresh probe). */
export function invalidateReadGatewayCache(): void {
  readGatewayCache = null
  ensureInFlight = null
}

/** Clears probe cache, env override suppression, and preferred host (for tests). */
export function resetArweaveReadGatewayForTests(): void {
  invalidateReadGatewayCache()
  BaseArweaveClient.resetReadGatewaySelectionStateForTests()
  if (!BaseArweaveClient.isReadGatewayLocked()) {
    BaseArweaveClient.setPreferredReadGateway(DEFAULT_ARWEAVE_HOST)
  }
}

/**
 * GET /info with timeout. Treat 2xx + JSON object as healthy.
 */
export async function probeGateway(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/info`
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
    if (!response.ok) return false
    const text = await response.text()
    if (!text.trim()) return false
    try {
      const json = JSON.parse(text) as unknown
      return typeof json === 'object' && json !== null
    } catch {
      return false
    }
  } catch {
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
    const baseUrl = `${protocol}://${h}`
    if (await probeGateway(baseUrl, signal)) {
      return h
    }
  }
  return null
}

function buildOrderedHostsForProbe(): string[] {
  const primary = BaseArweaveClient.getHost()
  const defaults = getDefaultArweaveReadGatewayHostsOrdered()
  return mergePrimaryHostWithDefaults(primary, defaults)
}

/**
 * Probes gateways in order and applies the first healthy host via {@link BaseArweaveClient.applyProbedReadGateway}.
 * No-op when the read gateway is locked ({@link BaseArweaveClient.setHost}).
 * Uses a short TTL cache to avoid probing on every read.
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
      }
    }

    readGatewayCache = {
      host: BaseArweaveClient.getHost(),
      expiresAt: Date.now() + READ_GATEWAY_CACHE_TTL_MS,
    }
    return readGatewayCache.host
  })()

  try {
    return await ensureInFlight
  } finally {
    ensureInFlight = null
  }
}
