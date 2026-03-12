import { getCorrectId } from '@/helpers'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import { IItem } from '@/interfaces'

/**
 * Collects all items that will be in the publish payload (main item + related items from
 * relations and lists). Used by ensureEasSchemas to register schemas for nested items.
 * Skips items that already have seedUid (already published).
 */
export async function getRelatedItemsForPublish(
  item: IItem<any>,
  visited = new Set<string>(),
): Promise<IItem<any>[]> {
  const seedLocalId = item.seedLocalId
  if (!seedLocalId || visited.has(seedLocalId)) {
    return []
  }
  visited.add(seedLocalId)

  const result: IItem<any>[] = []
  const { itemRelationProperties, itemImageProperties, itemListProperties } =
    await getSegmentedItemProperties(item)

  const getItemMod = await import('./getItem')
  const { getItem } = getItemMod

  const processRelationOrImage = async (prop: { getService: () => { getSnapshot: () => unknown } }) => {
    const snapshot = prop.getService().getSnapshot() as { context?: unknown }
    const context = snapshot.context ?? null
    if (!context) return
    const value = (context as { propertyValue?: unknown }).propertyValue
    if (!value) return
    const { localId: seedLocalId, uid: seedUid } = getCorrectId(value as string)
    const relatedItem = await getItem({ seedLocalId, seedUid })
    if (!relatedItem || relatedItem.seedUid) return
    const nested = await getRelatedItemsForPublish(relatedItem, visited)
    result.push(...nested, relatedItem)
  }

  for (const prop of [...itemRelationProperties, ...itemImageProperties]) {
    await processRelationOrImage(prop)
  }

  for (const listProperty of itemListProperties) {
    if (!listProperty.propertyDef?.ref) continue
    const snapshot = listProperty.getService().getSnapshot() as { context?: unknown }
    const context = snapshot.context ?? null
    if (!context) continue
    let value = (context as { propertyValue?: unknown }).propertyValue
    if (!value || (listProperty as { uid?: string }).uid) continue
    if (typeof value === 'string' && value.length === 66) value = [value]
    if (typeof value === 'string' && value.length > 66) {
      try {
        value = JSON.parse(value)
      } catch {
        value = (value as string).split(',')
      }
    }
    const arr = Array.isArray(value) ? value : []
    for (const seedId of arr) {
      const { localId: seedLocalId, uid: seedUid } = getCorrectId(seedId as string)
      const relatedItem = await getItem({ seedLocalId, seedUid })
      if (!relatedItem || relatedItem.seedUid) continue
      const nested = await getRelatedItemsForPublish(relatedItem, visited)
      result.push(...nested, relatedItem)
    }
  }

  return result
}
