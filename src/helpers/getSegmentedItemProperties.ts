import { UploadProperty } from '@/db/read/getPublishUploads'
import { IItem } from '@/interfaces'

export const getSegmentedItemProperties = (item: IItem<any>) => {
  const itemBasicProperties = []
  const itemRelationProperties = []
  const itemListProperties = []
  const itemUploadProperties: UploadProperty[] = []
  const itemImageProperties = []
  const itemStorageProperties = []
  let itemStorageTransactionProperty: UploadProperty | undefined

  for (const itemProperty of Object.values(item.properties)) {
    if (!itemProperty.propertyDef) {
      continue
    }

    const isItemStorage =
      itemProperty.propertyDef.storageType &&
      itemProperty.propertyDef.storageType === 'ItemStorage'


    const isStorageTransaction =
      itemProperty.propertyName === 'storageTransactionId'

    if (itemProperty.propertyDef.dataType === 'Image') {
      itemImageProperties.push(itemProperty)
      continue
    }

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
    itemImageProperties,
  }
}
