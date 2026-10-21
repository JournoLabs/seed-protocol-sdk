import debug from 'debug'
import { BaseFileManager } from './FileManager/BaseFileManager'

const logger = debug('seedSdk:helpers:localImageBlobUrl')

/**
 * A new blob: URL for `images/<txId>` in the files directory, or undefined when the file isn't
 * there. Each call creates a URL; the caller owns it and revokes it with `URL.revokeObjectURL`
 * once nothing displays it.
 */
export const convertTxIdToImage = async (txId: string): Promise<string | undefined> => {
  const imageFilePath = BaseFileManager.getFilesPath('images', txId)
  const fileExists = await BaseFileManager.pathExists(imageFilePath)
  if (!fileExists) {
    logger(`${imageFilePath} does not exist`)
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

  return URL.createObjectURL(new Blob([new Uint8Array(arrayBuffer)]))
}
