import { itemHasPublishUploadCandidates, type IItem } from '@seedprotocol/sdk'

/**
 * Returns true if the item needs the Arweave upload path (sign data items, upload)
 * before creating attestations. Returns false when the item has no storage or no values
 * to upload, in which case the publish flow can skip straight to EAS.
 *
 * Uses {@link itemHasPublishUploadCandidates}, which reads rows and file metadata only, so a plain
 * item record (a restored publish) works as well as a loaded Item.
 */
export async function itemNeedsArweaveUpload(item: Pick<IItem<any>, 'seedLocalId' | 'modelName'>): Promise<boolean> {
  return itemHasPublishUploadCandidates(item)
}
