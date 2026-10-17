import type { TransactionStatus } from '../types/arweave.js'
import {
  isGatewayHostCircuitOpen,
  recordGatewayHostFailure,
  recordGatewayHostSuccess,
} from './gatewayCircuitBreaker.js'
import { getArweaveReadBaseUrls } from './readBaseUrls.js'

/** Per-gateway timeout for a status check. A gateway can take minutes on an id it doesn't have. */
export const DEFAULT_TRANSACTION_STATUS_TIMEOUT_MS = 10_000

/** Time budget for a status check across all gateways. */
export const DEFAULT_TRANSACTION_STATUS_TOTAL_TIMEOUT_MS = 20_000

export type TransactionStatusFetchOptions = {
  timeoutMs?: number
  totalTimeoutMs?: number
  /** Base URLs to try in order. Defaults to {@link getArweaveReadBaseUrls}. */
  baseUrls?: readonly string[]
}

type Attempt = { kind: 'answer'; status: number } | { kind: 'retry'; status: number }

/** 5xx and 429 say nothing about the transaction; another gateway may answer. */
const isGatewayFailure = (status: number) => status >= 500 || status === 429

async function fetchStatusFromBaseUrl(baseUrl: string, transactionId: string, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(transactionId)}`, {
      method: 'GET',
      credentials: 'omit',
      signal: controller.signal,
    })
    // Presence only: don't download the body.
    await response.body?.cancel().catch(() => {})
    return isGatewayFailure(response.status)
      ? { kind: 'retry', status: response.status }
      : { kind: 'answer', status: response.status }
  } catch {
    return { kind: 'retry', status: controller.signal.aborted ? 504 : 500 }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * HTTP status of `GET {gateway}/{id}`, trying read gateways in order
 * ({@link getArweaveReadBaseUrls}: preferred, then the configured host, then public fallbacks; only
 * the proxy or sidecar when one is the active path). A gateway's 2xx-4xx answer is returned as is
 * (a 404 isn't retried elsewhere). A timeout, network error, 5xx or 429 moves on to the next
 * gateway, and gateways whose circuit is open are skipped. When none answers within the total
 * budget the status is 504 if the last attempt timed out, otherwise that attempt's status.
 */
export async function fetchTransactionStatusAcrossGateways(
  transactionId: string,
  options: TransactionStatusFetchOptions = {},
): Promise<TransactionStatus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSACTION_STATUS_TIMEOUT_MS
  const deadline = Date.now() + (options.totalTimeoutMs ?? DEFAULT_TRANSACTION_STATUS_TOTAL_TIMEOUT_MS)
  const baseUrls = options.baseUrls ?? getArweaveReadBaseUrls()
  const open = baseUrls.filter((url) => !isGatewayHostCircuitOpen(url))
  // Every circuit open: try them anyway rather than answer without asking.
  const candidates = open.length > 0 ? open : baseUrls

  let lastStatus = 500
  for (const baseUrl of candidates) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const attempt = await fetchStatusFromBaseUrl(baseUrl, transactionId, Math.min(timeoutMs, remaining))
    if (attempt.kind === 'answer') {
      recordGatewayHostSuccess(baseUrl)
      // Callers test for 200 (present); any 2xx means the gateway has it.
      const status = attempt.status >= 200 && attempt.status < 300 ? 200 : attempt.status
      return { status, confirmed: null }
    }
    recordGatewayHostFailure(baseUrl)
    lastStatus = attempt.status
  }
  return { status: lastStatus, confirmed: null }
}
