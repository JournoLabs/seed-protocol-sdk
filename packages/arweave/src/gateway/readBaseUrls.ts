import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { ensureReadGatewaySelected } from '../ArweaveClient/selectReadGateway.js'
import { getArweaveReadGatewayHostsForPrimary } from '../constants.js'
import { getPreferredArweaveReadBaseUrls, getResolvedSeedGatewayEndpoints } from './gatewayState.js'
import { getReadGatewayHostsForConfig } from './resolveSeedGatewayEndpoints.js'

/** Per-gateway timeout for {@link fetchArweaveRawFromBaseUrl}; a hung gateway must not block the next one. */
export const DEFAULT_ARWEAVE_RAW_READ_TIMEOUT_MS = 10_000

export type ArweaveReadBaseUrlOptions = {
  /** Hosts (no scheme) used when no gateway endpoints have been resolved, e.g. a feed's own list. */
  fallbackHosts?: readonly string[]
}

function pushUnique(out: string[], seen: Set<string>, url: string): void {
  const u = url.trim().replace(/\/$/, '')
  if (!u || seen.has(u)) return
  seen.add(u)
  out.push(u)
}

/**
 * Resolved / public read gateways as base URLs (scheme + host + any path prefix), without the
 * preferred ones. Does not probe.
 */
export function getResolvedArweaveReadBaseUrls(options?: ArweaveReadBaseUrlOptions): string[] {
  const resolved = getResolvedSeedGatewayEndpoints()
  const protocol = BaseArweaveClient.getProtocol()
  const hosts = resolved
    ? getReadGatewayHostsForConfig(resolved)
    : options?.fallbackHosts?.length
      ? [...options.fallbackHosts]
      : getArweaveReadGatewayHostsForPrimary(BaseArweaveClient.getHost())

  const out: string[] = []
  const seen = new Set<string>()
  for (const host of hosts) {
    const h = host.trim()
    if (!h) continue
    pushUnique(out, seen, /^https?:\/\//i.test(h) ? h : `${protocol}://${h}`)
  }
  return out
}

/**
 * Ordered base URLs for `/raw/{id}` (and `/{id}`) reads: preferred gateways
 * ({@link setPreferredArweaveReadBaseUrls}) first, then the resolved / public gateways. Does not probe.
 */
export function getArweaveReadBaseUrls(options?: ArweaveReadBaseUrlOptions): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const url of getPreferredArweaveReadBaseUrls()) pushUnique(out, seen, url)
  for (const url of getResolvedArweaveReadBaseUrls(options)) pushUnique(out, seen, url)
  return out
}

/** Run the read-gateway probe unless a sidecar / proxy is already the active path. Never throws. */
export async function ensureArweaveReadGatewayForFallback(): Promise<void> {
  try {
    const resolved = getResolvedSeedGatewayEndpoints()
    if (resolved && (resolved.activePath === 'hyper-sidecar' || resolved.activePath === 'http-proxy')) {
      return
    }
    await ensureReadGatewaySelected()
  } catch {
    /* optional — fall through to the current host */
  }
}

/** GET `{baseUrl}/raw/{id}`; `undefined` on network error, timeout or non-2xx. */
export async function fetchArweaveRawFromBaseUrl(
  baseUrl: string,
  transactionId: string,
  options?: { timeoutMs?: number },
): Promise<Response | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_ARWEAVE_RAW_READ_TIMEOUT_MS,
  )
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/raw/${encodeURIComponent(transactionId)}`, {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
    })
    return res.ok ? res : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET `/raw/{id}` across read gateways and return the first non-empty body as text. Preferred
 * gateways go first and are tried before any read-gateway probe; a just-published item is served
 * by the gateway it was uploaded through well before it reaches L1 or the public hosts.
 */
export async function fetchArweaveRawTextAcrossGateways(
  transactionId: string,
  options?: ArweaveReadBaseUrlOptions & { timeoutMs?: number },
): Promise<string | undefined> {
  const tried = new Set<string>()
  const tryUrls = async (urls: string[]): Promise<string | undefined> => {
    for (const base of urls) {
      if (tried.has(base)) continue
      tried.add(base)
      const res = await fetchArweaveRawFromBaseUrl(base, transactionId, options)
      if (!res) continue
      try {
        const text = await res.text()
        if (text.length > 0) return text
      } catch {
        /* body read failed — next gateway */
      }
    }
    return undefined
  }

  const preferred = await tryUrls(getPreferredArweaveReadBaseUrls())
  if (preferred) return preferred

  await ensureArweaveReadGatewayForFallback()
  return tryUrls(getResolvedArweaveReadBaseUrls(options))
}
