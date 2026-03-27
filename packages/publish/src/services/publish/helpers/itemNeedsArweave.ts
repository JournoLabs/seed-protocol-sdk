import { Item, itemHasPublishUploadCandidates, type IItem } from '@seedprotocol/sdk'

/**
 * Resolve a full Item (with getPublishUploads) by seedLocalId, polling until found.
 * Used when the input item might not have the data needed for the "needs Arweave" check.
 */
const resolveItem = async (seedLocalId: string): Promise<IItem<any>> => {
  let item: IItem<any> | undefined
  try {
    item = await Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
  } catch {
    // No-op: Error is intentionally ignored
  }
  if (item) return item

  return new Promise<IItem<any>>((resolve) => {
    const interval = setInterval(() => {
      Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
        .then((found: IItem<any> | undefined) => {
          if (found) {
            clearInterval(interval)
            resolve(found)
          }
        })
        .catch(() => {})
    }, 200)
  })
}

/**
 * Returns true if the item needs the Arweave upload path (reimbursement, poll, upload)
 * before creating attestations. Returns false when the item has no storage or no values
 * to upload, in which case the publish flow can skip straight to EAS.
 *
 * Uses {@link itemHasPublishUploadCandidates} (local paths / storage seeds only) so we do not
 * create Arweave transactions or call the network here — {@link getPublishUploads} builds txs
 * and can throw (e.g. gateway unreachable) even when uploads are required.
 */
export async function itemNeedsArweaveUpload(item: IItem<any>): Promise<boolean> {
  const usedPassedItem = typeof item.getPublishUploads === 'function'
  const resolved = usedPassedItem
    ? item
    : await resolveItem(item.seedLocalId)
  const needs = await itemHasPublishUploadCandidates(resolved)
  return needs
}
