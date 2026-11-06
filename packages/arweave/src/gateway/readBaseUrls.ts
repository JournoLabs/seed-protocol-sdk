import { BaseArweaveClient } from '../ArweaveClient/BaseArweaveClient.js'
import { ensureReadGatewaySelected } from '../ArweaveClient/selectReadGateway.js'
import { getArweaveReadGatewayHostsForPrimary } from '../constants.js'
import { getPreferredArweaveReadBaseUrls, getResolvedSeedGatewayEndpoints } from './gatewayState.js'
import { getReadGatewayHostsForConfig } from './resolveSeedGatewayEndpoints.js'
import { isEncryptedArweaveContent, readArweaveContentResponse } from '../content/arweaveContent.js'

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

/**
 * What one gateway answered to `/raw/{id}`: the HTTP status, `'timeout'` (our abort fired),
 * `'network'` (fetch threw; a browser reports a CORS-blocked answer this way, without its status),
 * `'empty'` (2xx with no bytes) or `'unreadable'` (2xx whose body or read transform failed).
 */
export type ArweaveRawReadOutcome = number | 'timeout' | 'network' | 'empty' | 'unreadable'

export type ArweaveRawReadAttempt = { baseUrl: string; outcome: ArweaveRawReadOutcome }

/** GET `{baseUrl}/raw/{id}`. `response` is set only for a 2xx answer. */
export async function fetchArweaveRawFromBaseUrl(
  baseUrl: string,
  transactionId: string,
  options?: { timeoutMs?: number },
): Promise<ArweaveRawReadAttempt & { response?: Response }> {
  const base = baseUrl.replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? DEFAULT_ARWEAVE_RAW_READ_TIMEOUT_MS,
  )
  try {
    const res = await fetch(`${base}/raw/${encodeURIComponent(transactionId)}`, {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
    })
    return res.ok
      ? { baseUrl: base, outcome: res.status, response: res }
      : { baseUrl: base, outcome: res.status }
  } catch {
    return { baseUrl: base, outcome: controller.signal.aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * GET `/raw/{id}` across read gateways, asking each at most once, and return the first non-empty
 * body with what each gateway asked answered. Preferred gateways go first and are tried before any
 * read-gateway probe; a just-published item is served by the gateway it was uploaded through well
 * before it reaches L1 or the public hosts. The configured host (`BaseArweaveClient.getBaseUrl()`)
 * goes last when the resolved list leaves it out.
 * The body goes through `transformArweaveContent` (see `content/arweaveContent.ts`); `decode: false`
 * returns the transaction's bytes as stored, as `getTransactionData` does.
 */
export async function readArweaveRawAcrossGateways(
  transactionId: string,
  options?: ArweaveReadBaseUrlOptions & { timeoutMs?: number; decode?: boolean },
): Promise<{ bytes?: Uint8Array; attempts: ArweaveRawReadAttempt[] }> {
  const attempts: ArweaveRawReadAttempt[] = []
  const tried = new Set<string>()
  const tryUrls = async (urls: string[]): Promise<Uint8Array | undefined> => {
    for (const url of urls) {
      const base = url.trim().replace(/\/$/, '')
      if (!base || tried.has(base)) continue
      tried.add(base)
      const { response, ...attempt } = await fetchArweaveRawFromBaseUrl(base, transactionId, options)
      if (!response) {
        attempts.push(attempt)
        continue
      }
      try {
        const bytes =
          options?.decode === false
            ? new Uint8Array(await response.arrayBuffer())
            : (await readArweaveContentResponse(response, { transactionId })).bytes
        if (bytes.byteLength > 0) {
          attempts.push(attempt)
          return bytes
        }
        attempts.push({ baseUrl: base, outcome: 'empty' })
      } catch {
        attempts.push({ baseUrl: base, outcome: 'unreadable' })
      }
    }
    return undefined
  }

  const preferred = await tryUrls(getPreferredArweaveReadBaseUrls())
  if (preferred) return { bytes: preferred, attempts }

  await ensureArweaveReadGatewayForFallback()
  const bytes = await tryUrls([...getResolvedArweaveReadBaseUrls(options), BaseArweaveClient.getBaseUrl()])
  return { bytes, attempts }
}

/** {@link readArweaveRawAcrossGateways}'s bytes; undefined when no gateway served any. */
export async function fetchArweaveRawBytesAcrossGateways(
  transactionId: string,
  options?: ArweaveReadBaseUrlOptions & { timeoutMs?: number; decode?: boolean },
): Promise<Uint8Array | undefined> {
  return (await readArweaveRawAcrossGateways(transactionId, options)).bytes
}

/** {@link fetchArweaveRawBytesAcrossGateways} as text; undefined for an encrypted envelope no transform opened. */
export async function fetchArweaveRawTextAcrossGateways(
  transactionId: string,
  options?: ArweaveReadBaseUrlOptions & { timeoutMs?: number },
): Promise<string | undefined> {
  const bytes = await fetchArweaveRawBytesAcrossGateways(transactionId, options)
  if (!bytes || isEncryptedArweaveContent(bytes)) return undefined
  return new TextDecoder().decode(bytes) || undefined
}
