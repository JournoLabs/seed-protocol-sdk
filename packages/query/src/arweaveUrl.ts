import { BaseArweaveClient } from '@seedprotocol/arweave'

/**
 * Builds an Arweave gateway URL for a transaction ID (no `/raw` segment).
 */
export function getArweaveUrlForTransaction(transactionId: string): string {
  return `https://${BaseArweaveClient.getHost()}/${transactionId}`
}
