import type { TransactionStatus } from '@/types/arweave'

/**
 * Trim and strip a trailing slash from an upload API base URL.
 */
export function normalizeUploadApiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * URL used to verify that an upload is available via the Seed upload API
 * (`GET` → HTTP 200 when present). Works for L1 transaction ids and ANS-104 data item ids.
 *
 * @param baseUrl - Upload API origin (e.g. from `ARWEAVE_UPLOAD_API_BASE_URL` / `uploadApiBaseUrl`)
 * @param txOrDataItemId - Arweave tx id or bundler data item id
 */
export function getUploadApiArweaveDataUrl(baseUrl: string, txOrDataItemId: string): string {
  const base = normalizeUploadApiBaseUrl(baseUrl)
  const id = encodeURIComponent(txOrDataItemId)
  return `${base}/api/upload/arweave/data/${id}`
}

/**
 * Presence check against the upload API data route (same semantics as
 * {@link BaseArweaveClient.getTransactionStatus} for gateways: 200 = present, 404 = missing).
 */
export async function getUploadPipelineTransactionStatus(
  uploadApiBaseUrl: string,
  txOrDataItemId: string,
): Promise<TransactionStatus> {
  const url = getUploadApiArweaveDataUrl(uploadApiBaseUrl, txOrDataItemId)

  try {
    const response = await fetch(url)

    if (response.status === 404) {
      return { status: 404, confirmed: null }
    }

    if (!response.ok) {
      return { status: response.status, confirmed: null }
    }

    if (response.body) {
      await response.body.cancel()
    }

    return { status: 200, confirmed: null }
  } catch {
    return { status: 500, confirmed: null }
  }
}
