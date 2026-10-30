import { GetCorrectId } from '@/types/helpers'
import { GetCorrectIdReturn } from '@/types/helpers'

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

