import { BaseArweaveClient } from '@seedprotocol/sdk'

/**
 * Builds an Arweave URL for a transaction ID (without the /raw segment).
 * Returns URLs like https://arweave.net/{transactionId} instead of
 * https://arweave.net/raw/{transactionId}.
 */
export function getArweaveUrlForTransaction(transactionId: string): string {
  return `https://${BaseArweaveClient.getHost()}/${transactionId}`
}
