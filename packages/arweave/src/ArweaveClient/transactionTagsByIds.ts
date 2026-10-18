import type { GraphQLClient } from 'graphql-request'
import { BaseArweaveClient } from './BaseArweaveClient.js'
import type { TransactionTag } from '../types/arweave.js'

/** Arweave GraphQL serves at most 100 transactions per page. */
export const TRANSACTION_TAGS_BATCH_SIZE = 100

/**
 * Plain string, not a codegen document: the `graphql()` helper from the client preset only knows
 * documents present when codegen last ran.
 */
export const GET_TRANSACTIONS_TAGS_BY_IDS = /* GraphQL */ `
  query GetTransactionsTagsByIds($ids: [ID!], $first: Int) {
    transactions(ids: $ids, first: $first) {
      edges {
        node {
          id
          tags {
            name
            value
          }
        }
      }
    }
  }
`

type TransactionsTagsByIdsResult = {
  transactions?: {
    edges?: Array<{ node?: { id?: string; tags?: TransactionTag[] | null } | null } | null> | null
  } | null
}

/**
 * Tags of many transactions in batched GraphQL requests (`transactions(ids: [...])`), keyed by id.
 * A transaction the gateway does not know yet (e.g. just published, not indexed) is absent from
 * the map; a failed batch is skipped (logged through `onError`) rather than failing the caller.
 */
export async function getTransactionTagsByIds(
  transactionIds: readonly string[],
  options?: { client?: GraphQLClient; batchSize?: number; onError?: (error: unknown) => void },
): Promise<Map<string, TransactionTag[]>> {
  const out = new Map<string, TransactionTag[]>()
  const ids = Array.from(new Set(transactionIds.filter((id) => typeof id === 'string' && id.trim())))
  if (ids.length === 0) return out

  const client = options?.client ?? BaseArweaveClient.getArweaveClient()
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? TRANSACTION_TAGS_BATCH_SIZE, TRANSACTION_TAGS_BATCH_SIZE))

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    try {
      const result = await client.request<TransactionsTagsByIdsResult>(GET_TRANSACTIONS_TAGS_BY_IDS, {
        ids: batch,
        first: batch.length,
      })
      for (const edge of result?.transactions?.edges ?? []) {
        const node = edge?.node
        if (!node?.id) continue
        out.set(
          node.id,
          (node.tags ?? []).map((tag) => ({ name: tag.name, value: tag.value })),
        )
      }
    } catch (error) {
      options?.onError?.(error)
    }
  }
  return out
}
