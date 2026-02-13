import { Item } from '@seedprotocol/sdk'

/**
 * Resolve a full Item (with getPublishUploads) by seedLocalId, polling until found.
 * Used when the input item might not have the data needed for the "needs Arweave" check.
 */
const resolveItem = async (seedLocalId: string): Promise<Item<unknown>> => {
  let item: Item<unknown> | undefined
  try {
    item = await Item.find({ seedLocalId })
  } catch {
    // No-op: Error is intentionally ignored
  }
  if (item) return item

  return new Promise<Item<unknown>>((resolve) => {
    const interval = setInterval(() => {
      Item.find({ seedLocalId })
        .then((found: Item<unknown> | undefined) => {
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
 * Uses item.getPublishUploads(): empty array means "no storage or no values to upload",
 * non-empty means at least one property has storageType and a value (needs Arweave).
 * If the SDK later exposes ItemProperties with propertyDef and value in a non-React
 * context, this could be replaced by an explicit check using propertyDef.storageType
 * and itemProperty.value.
 */
export async function itemNeedsArweaveUpload(item: Item<unknown>): Promise<boolean> {
  const resolved = typeof item.getPublishUploads === 'function'
    ? item
    : await resolveItem(item.seedLocalId)
  const publishUploads = await resolved.getPublishUploads()
  return publishUploads.length > 0
}
