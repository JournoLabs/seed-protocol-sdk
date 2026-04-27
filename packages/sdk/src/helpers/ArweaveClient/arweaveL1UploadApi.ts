import {
  getDefaultArweaveReadGatewayHostsOrdered,
  mergePrimaryHostWithDefaults,
} from '@/helpers/constants'
import { normalizeUploadApiBaseUrl } from './uploadApiVerification'
import { probeGateway } from './selectReadGateway'

/** Response shape from `GET /api/upload/arweave/status/{dataItemId}`. */
export interface ArweaveUploadStatusResponse {
  dataItemId?: string
  phase?: string
  bundleId?: string
  turboStatus?: string
  turboInfo?: string
  winc?: string
  turbo?: {
    status?: string
    bundleId?: string
    info?: string
    winc?: string
  }
  l1?: {
    checked?: boolean
    httpStatus?: number
    confirmed?: boolean
    numberOfConfirmations?: number
    minConfirmationsRequired?: number
    meetsMinConfirmations?: boolean
  }
}

export interface ArweaveGatewayTransactionQueryResult {
  /** GraphQL `transaction.id` (often same as data item id for ANS-104 items). */
  transactionId: string | null
  /** L1 bundle transaction id when the item is indexed as bundled. */
  bundledInId: string | null
  blockHeight?: number | null
  blockTimestamp?: number | null
}

const GATEWAY_TX_QUERY = `
  query ArweaveGatewayTransaction($id: String!) {
    transaction(id: $id) {
      id
      bundledIn {
        id
      }
      block {
        height
        timestamp
      }
    }
  }
`

export function getUploadApiArweaveStatusUrl(baseUrl: string, dataItemId: string): string {
  const base = normalizeUploadApiBaseUrl(baseUrl)
  const id = encodeURIComponent(dataItemId)
  return `${base}/api/upload/arweave/status/${id}`
}

/**
 * Whether L1 anchoring is complete per upload API status JSON.
 */
export function isArweaveL1AnchoringComplete(status: ArweaveUploadStatusResponse): boolean {
  const l1 = status.l1
  if (!l1) return false
  if (l1.meetsMinConfirmations === true) return true
  if (l1.confirmed === true) return true
  return false
}

/**
 * Fetches JSON from `GET /api/upload/arweave/status/{dataItemId}`.
 * Returns `null` if the response is not OK or body is not JSON.
 */
export async function getArweaveUploadStatus(
  uploadApiBaseUrl: string,
  dataItemId: string,
): Promise<ArweaveUploadStatusResponse | null> {
  const url = getUploadApiArweaveStatusUrl(uploadApiBaseUrl, dataItemId)
  try {
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    const body = (await response.json()) as ArweaveUploadStatusResponse
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

/**
 * Queries an Arweave gateway GraphQL API for transaction + bundle info.
 */
export async function queryArweaveGatewayTransaction(
  graphqlUrl: string,
  dataItemId: string,
  init?: Pick<RequestInit, 'signal'>,
): Promise<ArweaveGatewayTransactionQueryResult | null> {
  const url = graphqlUrl.trim()
  if (!url) return null

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: GATEWAY_TX_QUERY,
        variables: { id: dataItemId },
      }),
      signal: init?.signal,
    })

    if (!response.ok) {
      return null
    }

    const json = (await response.json()) as {
      data?: {
        transaction?: {
          id?: string
          bundledIn?: { id?: string } | null
          block?: { height?: number; timestamp?: number } | null
        } | null
      }
      errors?: unknown
    }

    if (json.errors) {
      return null
    }

    const tx = json.data?.transaction
    if (!tx) {
      return {
        transactionId: null,
        bundledInId: null,
        blockHeight: null,
        blockTimestamp: null,
      }
    }

    return {
      transactionId: typeof tx.id === 'string' ? tx.id : null,
      bundledInId: tx.bundledIn?.id != null ? String(tx.bundledIn.id) : null,
      blockHeight: tx.block?.height ?? null,
      blockTimestamp: tx.block?.timestamp ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Resolves GraphQL against the first healthy gateway (GET /info probe per host), then runs
 * {@link queryArweaveGatewayTransaction}. Host order: optional `graphqlUrl` hostname first, then
 * {@link getDefaultArweaveReadGatewayHostsOrdered}.
 */
export async function queryArweaveGatewayTransactionWithFallback(
  graphqlUrl: string | undefined,
  dataItemId: string,
  init?: Pick<RequestInit, 'signal'>,
): Promise<ArweaveGatewayTransactionQueryResult | null> {
  const defaults = getDefaultArweaveReadGatewayHostsOrdered()
  const trimmed = graphqlUrl?.trim()
  let protocol: 'http' | 'https' = 'https'
  let preferredHost: string | null = null
  if (trimmed) {
    try {
      const u = new URL(trimmed)
      protocol = u.protocol === 'http:' ? 'http' : 'https'
      preferredHost = u.hostname || null
    } catch {
      preferredHost = null
    }
  }

  const ordered =
    preferredHost && preferredHost.length > 0
      ? mergePrimaryHostWithDefaults(preferredHost, defaults)
      : [...defaults]

  const signal = init?.signal
  for (const host of ordered) {
    const base = `${protocol}://${host}`
    if (!(await probeGateway(base, signal ?? undefined))) continue
    const gqlUrl = `${protocol}://${host}/graphql`
    const result = await queryArweaveGatewayTransaction(gqlUrl, dataItemId, init)
    if (result !== null) {
      return result
    }
  }
  return null
}
