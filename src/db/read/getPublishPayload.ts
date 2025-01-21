import { getItem } from '@/db/read/getItem'
import {
  defaultAttestationData,
  INTERNAL_DATA_TYPES,
  VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
} from '@/helpers/constants'
import {
  AttestationRequest,
  SchemaEncoder,
  ZERO_BYTES32,
} from '@ethereum-attestation-service/eas-sdk'

import { getSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { toSnakeCase } from '@/helpers'
import pluralize from 'pluralize'
import { getSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { getSchemaUidForSchemaDefinition } from '@/stores/eas'
import { getCorrectId } from '@/helpers'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import { IItemProperty } from '@/interfaces'
import { IItem } from '@/interfaces'
import { BaseItem } from '@/Item/BaseItem'

const getVersionUid = (item: IItem<any>) => {
  let versionUid

  if (
    item.latestVersionUid &&
    item.latestVersionUid !== 'NULL' &&
    item.latestVersionUid !== 'undefined'
  ) {
    versionUid = item.latestVersionUid
  }
  return versionUid || ZERO_BYTES32
}

const getPropertyData = async (itemProperty: IItemProperty<any>) => {
  const easDataType =
    INTERNAL_DATA_TYPES[itemProperty.propertyDef!.dataType].eas

  let schemaUid: string | undefined = itemProperty.schemaUid

  const propertyNameForSchema = toSnakeCase(itemProperty.propertyName)

  const schemaDef = `${easDataType} ${propertyNameForSchema}`

  if (!schemaUid) {
    schemaUid = getSchemaUidForSchemaDefinition(schemaDef)
    if (!schemaUid) {
      const schema = await getSchemaForItemProperty({
        propertyName: 'version',
        easDataType: 'bytes32',
      })
      if (schema) {
        schemaUid = schema.id
      }
    }
  }

  return {
    schemaUid,
    easDataType,
    schemaDef,
    propertyNameForSchema,
  }
}

const processBasicProperties = async (
  itemBasicProperties: IItemProperty<any>[],
  itemPublishData: PublishPayload,
): Promise<PublishPayload> => {
  for (const basicProperty of itemBasicProperties) {
    const value = basicProperty.getService().getSnapshot().context.propertyValue

    if (!value || basicProperty.uid) {
      continue
    }

    const { schemaUid, easDataType, schemaDef } =
      await getPropertyData(basicProperty)

    const propertyNameForSchema = toSnakeCase(basicProperty.propertyName)

    const data = [
      {
        name: propertyNameForSchema,
        type: easDataType,
        value,
      },
    ]

    const dataEncoder = new SchemaEncoder(schemaDef)

    const encodedData = dataEncoder.encodeData(data)

    itemPublishData.listOfAttestations.push({
      schema: schemaUid!,
      data: [
        {
          ...defaultAttestationData,
          data: encodedData,
        },
      ],
    })
  }

  return itemPublishData
}

const processRelationProperty = async (
  relationProperty: IItemProperty<any>,
  multiPublishPayload: MultiPublishPayload,
  uploadedTransactions: UploadedTransaction[],
): Promise<MultiPublishPayload> => {
  const value = relationProperty.getService().getSnapshot()
    .context.propertyValue
  if (!value || relationProperty.uid) {
    return multiPublishPayload
  }

  const { localId: seedLocalId, uid: seedUid } = getCorrectId(value)

  const relatedItem = await getItem({
    seedLocalId,
    seedUid,
  })

  if (!relatedItem) {
    throw new Error(
      `No related item found for relation property: ${relationProperty.propertyName}`,
    )
  }

  const versionUid = getVersionUid(relatedItem)

  const seedSchemaUid = await getSchemaUidForModel(
    relationProperty.propertyDef!.ref as string,
  )

  let publishPayload: PublishPayload = {
    localId: relationProperty.localId,
    seedIsRevocable: true,
    versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
    seedUid: seedUid || ZERO_BYTES32,
    seedSchemaUid,
    versionUid,
    listOfAttestations: [],
    propertiesToUpdate: [
      {
        publishLocalId: relationProperty.localId,
        propertySchemaUid: relationProperty.schemaUid,
      },
    ],
  }

  const { itemBasicProperties, itemUploadProperties } =
    getSegmentedItemProperties(relatedItem)

  if (itemUploadProperties.length === 1) {
    const uploadProperty = itemUploadProperties[0]
    const itemProperty = uploadProperty.itemProperty
    const transactionData = uploadedTransactions.find(
      (transaction) => transaction.seedLocalId === relatedItem.seedLocalId,
    )
    if (transactionData) {
      itemProperty.value = transactionData.txId
      await itemProperty.save()
      itemBasicProperties.push(itemProperty)
    }
  }

  publishPayload = await processBasicProperties(
    itemBasicProperties,
    publishPayload,
  )

  multiPublishPayload.push(publishPayload)

  return multiPublishPayload
}

const processListProperty = async (
  listProperty: IItemProperty<any>,
  multiPublishPayload: MultiPublishPayload,
): Promise<MultiPublishPayload> => {
  let value = listProperty.getService().getSnapshot().context.propertyValue
  if (!value || listProperty.uid) {
    return multiPublishPayload
  }

  const singularPropertyName = pluralize.singular(listProperty.propertyName)
  const propertyNameForSchema = `${singularPropertyName}${listProperty.propertyDef!.ref}Ids`
  if (typeof value === 'string' && value.length === 66) {
    value = [value]
  }
  if (typeof value === 'string' && value.length > 66) {
    try {
      value = JSON.parse(value)
    } catch (error) {
      value = value.split(',')
    }
  }

  for (const seedId of value) {
    const { localId: seedLocalId, uid: seedUid } = getCorrectId(seedId)

    const relatedItem = await getItem({
      seedLocalId,
      seedUid,
    })

    if (!relatedItem) {
      console.error(
        `No related item found for list property: ${listProperty.propertyName}`,
      )
      continue
    }

    if (relatedItem.seedUid) {
      return multiPublishPayload
    }

    const versionUid = getVersionUid(relatedItem)

    const seedSchemaUid = await getSchemaUidForModel(
      listProperty.propertyDef!.ref as string,
    )

    let publishPayload: PublishPayload = {
      localId: relatedItem.seedLocalId,
      seedIsRevocable: true,
      versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
      seedUid: seedUid || ZERO_BYTES32,
      seedSchemaUid,
      versionUid,
      listOfAttestations: [],
      propertiesToUpdate: [
        {
          publishLocalId: listProperty.localId,
          propertySchemaUid: listProperty.schemaUid,
        },
      ],
    }

    const { itemBasicProperties } = getSegmentedItemProperties(relatedItem)

    publishPayload = await processBasicProperties(
      itemBasicProperties,
      publishPayload,
    )

    multiPublishPayload.push(publishPayload)
  }

  return multiPublishPayload
}

type PublishPayload = {
  localId: string
  seedIsRevocable: boolean
  seedSchemaUid: string
  seedUid: string
  versionSchemaUid: string
  versionUid: string
  listOfAttestations: AttestationRequest[]
  propertiesToUpdate: any[]
}

type MultiPublishPayload = PublishPayload[]

type UploadedTransaction = {
  txId: string
  itemPropertyLocalId?: string
  seedLocalId?: string
  versionLocalId?: string
  itemPropertyName?: string
}

export const getPublishPayload = async (
  item: BaseItem<any>,
  uploadedTransactions: UploadedTransaction[],
): Promise<MultiPublishPayload> => {

  let multiPublishPayload: MultiPublishPayload = []

  // Each PublishPayload is generated from a Seed that needs publishing

  // First we need to determine all Seeds to publish

  // That means the Seed of the Item, plus any Seeds pointed to by Relations

  let itemPublishData: PublishPayload = {
    localId: item.seedLocalId,
    seedUid: item.seedUid || ZERO_BYTES32,
    seedIsRevocable: true,
    seedSchemaUid: item.schemaUid,
    versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
    versionUid: getVersionUid(item),
    listOfAttestations: [],
    propertiesToUpdate: [],
  }

  const {
    itemBasicProperties,
    itemRelationProperties,
    itemListProperties,
    itemUploadProperties,
  } = getSegmentedItemProperties(item)

  if (itemUploadProperties.length === 1) {
    const uploadProperty = itemUploadProperties[0]
    const itemProperty = uploadProperty.itemProperty
    const transactionData = uploadedTransactions.find(
      (transaction) => transaction.seedLocalId === item.seedLocalId,
    )
    if (transactionData) {
      itemProperty.value = transactionData.txId
      await itemProperty.save()
      itemBasicProperties.push(itemProperty)
    }
  }

  for (const relationProperty of itemRelationProperties) {
    multiPublishPayload = await processRelationProperty(
      relationProperty,
      multiPublishPayload,
      uploadedTransactions,
    )
    itemBasicProperties.push(relationProperty)
  }
  
  itemPublishData = await processBasicProperties(
    itemBasicProperties,
    itemPublishData,
  )

  multiPublishPayload.push(itemPublishData)


  for (const listProperty of itemListProperties) {
    multiPublishPayload = await processListProperty(
      listProperty,
      multiPublishPayload,
    )
  }

  return multiPublishPayload
}
