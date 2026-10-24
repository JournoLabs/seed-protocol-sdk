import { GetCorrectId } from '@/types/helpers'
import { GetCorrectIdReturn } from '@/types/helpers'
import { BaseArweaveClient } from '@seedprotocol/arweave'

export * from './FileManager/BaseFileManager'
export * from './publishConfig'
export * from './metadataPropertyNames'
export * from './relationSeedRef'
export * from './mediaRef'
export { generateId } from './generateId'

export const getCorrectId: GetCorrectId = (localIdOrUid: string) => {
  const id: GetCorrectIdReturn = {
    localId: undefined,
    uid: undefined,
  }
  if (!localIdOrUid) {
    return id
  }
  if (localIdOrUid.length === 10) {
    id.localId = localIdOrUid
  }
  if (localIdOrUid.startsWith('0x') && localIdOrUid.length === 66) {
    id.uid = localIdOrUid
  }
  return id
}

export { convertTxIdToImage } from './localImageBlobUrl'

/**
 * Constructs an Arweave URL for a storage transaction ID
 * @param storageTransactionId - The Arweave transaction ID
 * @returns The full URL to access the transaction data on Arweave (e.g., https://arweave.net/raw/{transactionId})
 * @deprecated Use BaseArweaveClient.getRawUrl() instead for better consistency and testability
 */
export const getArweaveUrlForTransaction = (storageTransactionId: string): string => {
  return BaseArweaveClient.getRawUrl(storageTransactionId)
}
