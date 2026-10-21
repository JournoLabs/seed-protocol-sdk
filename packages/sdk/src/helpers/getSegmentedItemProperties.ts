import { UploadProperty } from '@/db/read/getPublishUploads'
import { IItem } from '@/interfaces'
import { ModelPropertyDataTypes, normalizeDataType } from '@/Schema'
import { getPropertySchema, TProperty } from '@/helpers/property'
import { getPropertyDefinition, type PropertyDefinition } from '@/helpers/propertyDefinition'
import { getItemModelScope, type ModelScope } from '@/db/read/resolveModelRecord'
import type { Static } from '@sinclair/typebox'
import { camelCase, upperFirst } from 'lodash-es'
import { reconcilePropertyDraftRows } from '@/helpers/reconcilePropertyDraftRows'

const matchesDataType = (
  actual: string | undefined,
  expected: ModelPropertyDataTypes | string,
): boolean => normalizeDataType(actual) === expected

/**
 * The definition of an item property that has none in its context, from its row: by property_id
 * when the context has one, else by the item's model and the property name. Publish can't route or
 * attest a property without one, so a property with no row throws.
 */
export async function resolveItemPropertyDefinition(
  item: IItem<any>,
  itemProperty: IItem<any>['properties'][number],
  scope?: ModelScope,
): Promise<PropertyDefinition> {
  const context = (itemProperty.getService().getSnapshot() as { context?: { propertyId?: number | null } }).context ?? {}
  if (context.propertyId != null) {
    const definition = await getPropertyDefinition(context.propertyId)
    if (definition) return definition
  }
  if (item.modelName) {
    // getItem's modelName can be the display form ("Blog Post")
    for (const modelName of new Set([item.modelName, upperFirst(camelCase(item.modelName))])) {
      const definition = await getPropertySchema(modelName, itemProperty.propertyName, scope ?? (await getItemModelScope(item as any)))
      if (definition) return definition
    }
  }
  throw new Error(
    `Property "${itemProperty.propertyName}" of ${item.modelName ?? 'an item'} (${item.seedLocalId}) has no definition: ` +
      `its model has no properties row by that name`,
  )
}

export const getSegmentedItemProperties = async (item: IItem<any>) => {
  const itemBasicProperties = []
  const itemRelationProperties = []
  const itemListProperties = []
  const itemUploadProperties: UploadProperty[] = []
  const itemImageProperties = []
  const itemStorageProperties = []
  let itemStorageTransactionProperty: UploadProperty | undefined
  let itemScope: ModelScope | undefined

  // Publish decides from each property's uid; it must name the property's newest row.
  await reconcilePropertyDraftRows(item)

  for (const itemProperty of item.properties) {
    let propertyDef = itemProperty.propertyDef
    // No definition in the context (e.g. an external app's item whose Model isn't loaded): read it
    // so the property is routed and attested
    if (!propertyDef) {
      itemScope ??= item.modelName ? await getItemModelScope(item as any) : {}
      const resolved = await resolveItemPropertyDefinition(item, itemProperty, itemScope)
      itemProperty.getService().send({ type: 'updateContext', propertyRecordSchema: resolved })
      propertyDef = resolved as unknown as Static<typeof TProperty>
    }

    const isItemStorage =
      propertyDef.storageType &&
      propertyDef.storageType === 'ItemStorage'


    const isStorageTransaction =
      itemProperty.propertyName === 'storageTransactionId' ||
      itemProperty.propertyName === 'storage_transaction_id'

    const isStorageSeedType =
      matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.Image) ||
      matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.File) ||
      matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.Html) ||
      matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.Json) ||
      (matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.Relation) &&
        (matchesDataType(propertyDef.refValueType, ModelPropertyDataTypes.Image) ||
          matchesDataType(propertyDef.refValueType, ModelPropertyDataTypes.File) ||
          matchesDataType(propertyDef.refValueType, ModelPropertyDataTypes.Html) ||
          matchesDataType(propertyDef.refValueType, ModelPropertyDataTypes.Json)))

    if (isStorageSeedType) {
      itemImageProperties.push(itemProperty)
      if (matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.Relation)) {
        itemRelationProperties.push(itemProperty)
      }
      continue
    }

    if (matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.Relation)) {
      itemRelationProperties.push(itemProperty)
      continue
    }

    if (matchesDataType(propertyDef.dataType, ModelPropertyDataTypes.List)) {
      // List-of-relations: ref present, goes to processListProperty
      // List-of-primitives: ref absent, treat as basic property
      const listRef =
        propertyDef.ref || (propertyDef as { refModelName?: string }).refModelName
      if (listRef) {
        itemListProperties.push(itemProperty)
      } else {
        itemBasicProperties.push(itemProperty)
      }
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
