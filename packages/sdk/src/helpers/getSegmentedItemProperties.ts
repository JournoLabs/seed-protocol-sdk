import { UploadProperty } from '@/db/read/getPublishUploads'
import { IItem } from '@/interfaces'
import { ModelPropertyDataTypes } from '@/Schema'
import { getPropertySchema, TProperty } from '@/helpers/property'
import type { Static } from '@sinclair/typebox'
import { BaseDb } from '@/db/Db/BaseDb'
import { models, properties } from '@/seedSchema'
import { eq, and } from 'drizzle-orm'
import { camelCase, upperFirst } from 'lodash-es'
async function resolvePropertyDef(
  modelName: string,
  propertyName: string,
): Promise<{ dataType?: string; ref?: string; refValueType?: string; storageType?: string; localStorageDir?: string; filenameSuffix?: string; required?: boolean } | undefined> {
  let schema = await getPropertySchema(modelName, propertyName)
  if (schema) return schema
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  try {
    const normalizedModelName = upperFirst(camelCase(modelName))
    const modelRecords = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.name, normalizedModelName))
      .limit(1)
    if (modelRecords.length === 0 || !modelRecords[0].id) return undefined
    const propertyRecords = await db
      .select()
      .from(properties)
      .where(
        and(
          eq(properties.modelId, modelRecords[0].id),
          eq(properties.name, propertyName),
        ),
      )
      .limit(1)
    if (propertyRecords.length === 0) return undefined
    const propRecord = propertyRecords[0]
    let refModelName: string | undefined
    if (propRecord.refModelId != null) {
      const refModelRows = await db
        .select({ name: models.name })
        .from(models)
        .where(eq(models.id, propRecord.refModelId))
        .limit(1)
      refModelName = refModelRows[0]?.name ?? undefined
    }
    return {
      dataType: propRecord.dataType,
      ref: refModelName ?? undefined,
      refValueType: propRecord.refValueType || undefined,
      storageType: propRecord.storageType || undefined,
      localStorageDir: propRecord.localStorageDir || undefined,
      filenameSuffix: propRecord.filenameSuffix || undefined,
      required: propRecord.required ?? undefined,
    }
  } catch {
    return undefined
  }
}

export const getSegmentedItemProperties = async (item: IItem<any>) => {
  const itemBasicProperties = []
  const itemRelationProperties = []
  const itemListProperties = []
  const itemUploadProperties: UploadProperty[] = []
  const itemImageProperties = []
  const itemStorageProperties = []
  let itemStorageTransactionProperty: UploadProperty | undefined

  for (const itemProperty of item.properties) {
    let propertyDef = itemProperty.propertyDef
    // When propertyDef is missing (e.g. external app, Model not registered), resolve inline
    // so properties are not skipped and metadata attestations can be created
    if (!propertyDef && item.modelName) {
      const resolved = await resolvePropertyDef(item.modelName, itemProperty.propertyName)
      if (resolved) {
        itemProperty.getService().send({ type: 'updateContext', propertyRecordSchema: resolved })
        propertyDef = resolved as Static<typeof TProperty>
      } else {
        // Last resort: Model and DB don't have schema. Use Text so property routes to
        // itemBasicProperties and can be attested (covers title, description, etc.)
        const fallbackDef = { dataType: 'Text' as const }
        itemProperty.getService().send({ type: 'updateContext', propertyRecordSchema: fallbackDef })
        propertyDef = fallbackDef as Static<typeof TProperty>
      }
    }
    if (!propertyDef) {
      continue
    }

    const isItemStorage =
      propertyDef.storageType &&
      propertyDef.storageType === 'ItemStorage'


    const isStorageTransaction =
      itemProperty.propertyName === 'storageTransactionId' ||
      itemProperty.propertyName === 'storage_transaction_id'

    const isStorageSeedType =
      propertyDef.dataType === ModelPropertyDataTypes.Image ||
      propertyDef.dataType === ModelPropertyDataTypes.File ||
      propertyDef.dataType === ModelPropertyDataTypes.Html ||
      propertyDef.dataType === ModelPropertyDataTypes.Json ||
      (propertyDef.dataType === ModelPropertyDataTypes.Relation &&
        (propertyDef.refValueType === ModelPropertyDataTypes.Image ||
          propertyDef.refValueType === ModelPropertyDataTypes.File ||
          propertyDef.refValueType === ModelPropertyDataTypes.Html ||
          propertyDef.refValueType === ModelPropertyDataTypes.Json))

    if (isStorageSeedType) {
      itemImageProperties.push(itemProperty)
      if (propertyDef.dataType === ModelPropertyDataTypes.Relation) {
        itemRelationProperties.push(itemProperty)
      }
      continue
    }

    if (propertyDef.dataType === ModelPropertyDataTypes.Relation) {
      itemRelationProperties.push(itemProperty)
      continue
    }

    if (propertyDef.dataType === ModelPropertyDataTypes.List) {
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
