import { Item } from '@/browser'
import { UploadProperty } from '@/browser/db/read/getPublishUploads'

export const getSegmentedItemProperties = (item: Item<any>) => {
  const itemBasicProperties = []
  const itemRelationProperties = []
  const itemListProperties = []
  const itemUploadProperties: UploadProperty[] = []
  const itemStorageProperties = []
  let itemStorageTransactionProperty: UploadProperty | undefined

  for (const itemProperty of Object.values(item.properties)) {
    if (!itemProperty.propertyDef) {
      continue
    }

    const isItemStorage =
      itemProperty.propertyDef.storageType &&
      itemProperty.propertyDef.storageType === 'ItemStorage'

    const isImageSrc =
      itemProperty.propertyDef.dataType === 'Relation' &&
      itemProperty.propertyDef.refValueType === 'ImageSrc'

    const isStorageTransaction =
      itemProperty.propertyName === 'storageTransactionId'

    if (itemProperty.propertyDef.dataType === 'Relation') {
      itemRelationProperties.push(itemProperty)
      continue
    }

    if (itemProperty.propertyDef.dataType === 'List') {
      itemListProperties.push(itemProperty)
      continue
    }

    if (isItemStorage) {
      itemStorageProperties.push(itemProperty)
      continue
    }

    if (isStorageTransaction) {
      itemStorageTransactionProperty = { itemProperty, childProperties: [] }
      continue
    }

    itemBasicProperties.push(itemProperty)
  }

  if (itemStorageTransactionProperty && itemStorageProperties.length > 0) {
    itemStorageTransactionProperty.childProperties = itemStorageProperties
  }

  if (itemStorageTransactionProperty) {
    itemUploadProperties.push(itemStorageTransactionProperty)
  }

  return {
    itemBasicProperties,
    itemRelationProperties,
    itemListProperties,
    itemUploadProperties,
  }
}
