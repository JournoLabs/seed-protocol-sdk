import debug from 'debug'
import { GetCorrectId } from '@/types/helpers'
import { GetCorrectIdReturn } from '@/types/helpers'
import { BaseFileManager } from './FileManager/BaseFileManager'
import {
  BaseArweaveClient,
  ensureReadGatewaySelected,
  isReadGatewayKnownHealthy,
  getLastHealthyReadGatewayHost,
  isGatewayHostCircuitOpen,
  recordGatewayHostSuccess,
  recordGatewayHostFailure,
  normalizeGatewayHostKey,
  resolveSeedGatewayEndpoints,
  getReadGatewayHostsForConfig,
  seedGatewayConfigFromSeedConfig,
  getResolvedSeedGatewayEndpoints,
  setResolvedSeedGatewayEndpoints,
} from '@seedprotocol/arweave'
import { BaseEasClient, BaseQueryClient } from '@seedprotocol/eas'

export {
  BaseArweaveClient,
  ensureReadGatewaySelected,
  isReadGatewayKnownHealthy,
  getLastHealthyReadGatewayHost,
  isGatewayHostCircuitOpen,
  recordGatewayHostSuccess,
  recordGatewayHostFailure,
  normalizeGatewayHostKey,
  resolveSeedGatewayEndpoints,
  getReadGatewayHostsForConfig,
  seedGatewayConfigFromSeedConfig,
  getResolvedSeedGatewayEndpoints,
  setResolvedSeedGatewayEndpoints,
  BaseEasClient,
  BaseQueryClient,
}

// Exported object keeps external facade bindings live for Rollup. Dynamic
// `await import('@/helpers')` otherwise emits a frozen module-namespace that
// can reference tree-shaken imports → ReferenceError in the browser.
export const __rollupExternalFacadeInterop = {
  BaseArweaveClient,
  BaseEasClient,
  BaseQueryClient,
  ensureReadGatewaySelected,
  isReadGatewayKnownHealthy,
  getLastHealthyReadGatewayHost,
  isGatewayHostCircuitOpen,
  recordGatewayHostSuccess,
  recordGatewayHostFailure,
  normalizeGatewayHostKey,
  resolveSeedGatewayEndpoints,
  getReadGatewayHostsForConfig,
  seedGatewayConfigFromSeedConfig,
  getResolvedSeedGatewayEndpoints,
  setResolvedSeedGatewayEndpoints,
} as const

export * from './FileManager/BaseFileManager'
export { waitForEntityIdle } from './waitForEntityIdle'
export * from './publishConfig'
export * from './metadataPropertyNames'
export * from './relationSeedRef'
export * from './mediaRef'
export {
  ensureImageLocal,
  closestImageSize,
  normalizeArweaveTxIdForEnsure,
  resetEnsureImageLocalInFlightForTests,
} from './ensureImageLocal'
export type {
  EnsureImageLocalParams,
  EnsureImageLocalResult,
} from './ensureImageLocal'
export { generateId } from './generateId'
const logger = debug('seedSdk:shared:helpers')

export { easName } from '@seedprotocol/eas'


export const getMimeType = (base64: string) => {
  if (!base64) {
    return null
  }
  const result = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,/)

  if (result && result.length > 1) {
    return result[1]
  } else {
    return null // MIME type could not be determined
  }
}

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

export const getDataTypeFromString = (
  data: string,
): 'imageBase64' | 'base64' | 'url' | null => {
  const nonImageBase64Regex =
    /^(?!data:image\/(?:jpeg|png|gif|bmp|webp);base64,)[A-Za-z0-9+/=]+$/

  if (nonImageBase64Regex.test(data)) {
    return 'base64'
  }

  // Regular expression for base64 (simple version, checking for base64 format)
  const imageBase64Regex = /^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/

  if (imageBase64Regex.test(data)) {
    return 'imageBase64'
  }

  // Blob URLs are fetchable but session-scoped; recognize them as url type
  if (data.startsWith('blob:')) {
    return 'url'
  }

  // Regular expression for URL (simple version, checking for common URL format)
  const urlRegex =
    /^(http:\/\/www\.|https:\/\/www\.|http:\/\/|https:\/\/)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/

  if (urlRegex.test(data)) {
    return 'url'
  }

  return null
}

export const convertTxIdToImage = async (
  txId: string,
): Promise<string | undefined> => {
  const imageFilePath = BaseFileManager.getFilesPath('images', txId)
  const fileExists = await BaseFileManager.pathExists(imageFilePath)
  if (!fileExists) {
    logger(`[ItemView] [updateImage] ${imageFilePath} does not exist`)
    return
  }
  const buffer = await BaseFileManager.readFileAsBuffer(imageFilePath)

  // Convert Blob to ArrayBuffer if needed, or use Buffer directly
  let arrayBuffer: ArrayBuffer
  if (buffer instanceof Blob) {
    arrayBuffer = await buffer.arrayBuffer()
  } else if (buffer instanceof ArrayBuffer) {
    arrayBuffer = buffer
  } else {
    // Node.js Buffer
    const sliced = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    // Handle SharedArrayBuffer case by creating a new ArrayBuffer
    if (sliced instanceof SharedArrayBuffer) {
      const uint8Array = new Uint8Array(sliced)
      arrayBuffer = uint8Array.buffer.slice(0) as unknown as ArrayBuffer
    } else {
      arrayBuffer = sliced as ArrayBuffer
    }
  }

  const uint = new Uint8Array(arrayBuffer)

  const imageBlob = new Blob([uint])

  return URL.createObjectURL(imageBlob)
}

/**
 * Constructs an Arweave URL for a storage transaction ID
 * @param storageTransactionId - The Arweave transaction ID
 * @returns The full URL to access the transaction data on Arweave (e.g., https://arweave.net/raw/{transactionId})
 * @deprecated Use BaseArweaveClient.getRawUrl() instead for better consistency and testability
 */
export const getArweaveUrlForTransaction = (storageTransactionId: string): string => {
  return BaseArweaveClient.getRawUrl(storageTransactionId)
}
