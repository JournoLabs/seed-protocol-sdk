import { errorChain } from '../errorChain'

/**
 * What a failed sponsored send says about the sponsor:
 * - `'declined'`: the paymaster answered with a JSON-RPC error
 * - `'deposit_low'`: the bundler rejected the op with `AA31` (paymaster deposit too low)
 * - `'unreachable'`: the paymaster request failed in transport (network error, timeout, HTTP error),
 *   or it answered an error that says the service can't serve (internal error, rate limit, or
 *   method not found, as from a URL that isn't a paymaster)
 * - `undefined`: the failure isn't the sponsor's
 *
 * A JSON-RPC error is only told apart from a bundler error by its URL, so with `bundlerUrl` equal
 * to `paymasterUrl` only `AA31` counts.
 */
export function classifySponsorFailure(
  err: unknown,
  urls: { paymasterUrl: string; bundlerUrl?: string },
): 'declined' | 'deposit_low' | 'unreachable' | undefined {
  const chain = errorChain(err)
  if (chain.some((e) => /\bAA31\b/i.test(errorText(e)))) return 'deposit_low'
  if (urls.bundlerUrl !== undefined && sameUrl(urls.bundlerUrl, urls.paymasterUrl)) return undefined
  for (const e of chain) {
    const { name, url } = e as { name?: unknown; url?: unknown }
    if (typeof url !== 'string' || !sameUrl(url, urls.paymasterUrl)) continue
    if (name === 'RpcRequestError') {
      const { code } = e as { code?: unknown }
      return typeof code === 'number' && SERVICE_FAILURE_CODES.has(code) ? 'unreachable' : 'declined'
    }
    if (name === 'HttpRequestError' || name === 'TimeoutError') return 'unreachable'
  }
  return undefined
}

/**
 * JSON-RPC codes that mean the paymaster service failed rather than refused: internal error,
 * rate limits (-32005, -32007, 429) and method not found. viem also turns a 5xx or 429 response
 * with a JSON-RPC error body into one of these.
 */
const SERVICE_FAILURE_CODES = new Set([-32603, -32005, -32007, 429, -32601])

/** True when `err` (or a cause) is the bundler's `AA21`: the sender can't pay its prefund. */
export function isInsufficientPrefund(err: unknown): boolean {
  return errorChain(err).some((e) => /\bAA21\b/i.test(errorText(e)))
}

function errorText(e: unknown): string {
  const { message, details, shortMessage } = e as { message?: unknown; details?: unknown; shortMessage?: unknown }
  return `${String(message ?? e)} ${String(details ?? '')} ${String(shortMessage ?? '')}`
}

export const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
