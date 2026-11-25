import { errorChain } from '../errorChain'

/**
 * What a failed sponsored send says about the sponsor:
 * - `'declined'`: the paymaster answered with a JSON-RPC error
 * - `'deposit_low'`: the bundler rejected the op with `AA31` (paymaster deposit too low)
 * - `'unreachable'`: the paymaster request failed in transport (network error, timeout, HTTP error)
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
    if (name === 'RpcRequestError') return 'declined'
    if (name === 'HttpRequestError' || name === 'TimeoutError') return 'unreachable'
  }
  return undefined
}

/** True when `err` (or a cause) is the bundler's `AA21`: the sender can't pay its prefund. */
export function isInsufficientPrefund(err: unknown): boolean {
  return errorChain(err).some((e) => /\bAA21\b/i.test(errorText(e)))
}

function errorText(e: unknown): string {
  const { message, details, shortMessage } = e as { message?: unknown; details?: unknown; shortMessage?: unknown }
  return `${String(message ?? e)} ${String(details ?? '')} ${String(shortMessage ?? '')}`
}

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
