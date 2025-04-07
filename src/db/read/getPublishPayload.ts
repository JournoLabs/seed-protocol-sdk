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
import debug from 'debug'
import {ethers} from 'ethers'
const logger = debug('seedSdk:db:getPublishPayload')

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
    schemaUid = await getSchemaUidForSchemaDefinition({ schemaText: schemaDef })
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
    let value = basicProperty.getService().getSnapshot().context.propertyValue

    if (!value || basicProperty.uid) {
      continue
    }

    const { schemaUid, easDataType, schemaDef } =
      await getPropertyData(basicProperty)

    const propertyNameForSchema = toSnakeCase(basicProperty.propertyName)

    if (schemaDef.startsWith('bytes32[]') && !Array.isArray(value)) {
      throw new Error(`Invalid value for property: ${basicProperty.propertyName}. Expected an array of bytes32, got ${value}.`)
    }

    if (schemaDef.startsWith('bytes32[]')) {
      const newValues = []
      for (const seedId of value) {
        if (seedId.length !== 66 && !seedId.startsWith('0x')) {
          newValues.push(ethers.encodeBytes32String(seedId))
          continue
        }
        newValues.push(seedId)
      }
      value = newValues
    }

    let data = [
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


const processRelationOrImageProperty = async (
  relationOrImageProperty: IItemProperty<any>,
  multiPublishPayload: MultiPublishPayload,
  uploadedTransactions: UploadedTransaction[],
  originalSeedLocalId: string,
): Promise<MultiPublishPayload> => {

  if (!relationOrImageProperty.schemaUid) {
    throw new Error(
      `Schema uid not found for relation or image property: ${relationOrImageProperty.propertyName}`,
    )
  }

  const value = relationOrImageProperty.getService().getSnapshot()
    .context.propertyValue
  if (!value || relationOrImageProperty.uid) {
    return multiPublishPayload
  }

  const { localId: seedLocalId, uid: seedUid } = getCorrectId(value)

  const relatedItem = await getItem({
    seedLocalId,
    seedUid,
  })

  if (!relatedItem) {
    throw new Error(
      `No related item found for relation or image property: ${relationOrImageProperty.propertyName}`,
    )
  }

  const versionUid = getVersionUid(relatedItem)

  let modelName: string

  if (relationOrImageProperty.propertyDef?.dataType === 'Image') {
    modelName = 'Image'
  }

  if (relationOrImageProperty.propertyDef?.dataType === 'Relation') {
    modelName = relationOrImageProperty.propertyDef!.ref as string
  }

  const seedSchemaUid = await getSchemaUidForModel(
    modelName!,
  )

  let publishPayload: PublishPayload = {
    localId: relationOrImageProperty.localId,
    seedIsRevocable: true,
    versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
    seedUid: seedUid || ZERO_BYTES32,
    seedSchemaUid,
    versionUid,
    listOfAttestations: [],
    propertiesToUpdate: [
      {
        publishLocalId: originalSeedLocalId,
        propertySchemaUid: relationOrImageProperty.schemaUid,
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
  originalSeedLocalId: string,
): Promise<MultiPublishPayload> => {

  if (!listProperty.schemaUid) {
    throw new Error(
      `Schema uid not found for list property: ${listProperty.propertyName}`,
    )
  }

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

    let modelName: string

    if (listProperty.propertyDef?.ref) {
      modelName = listProperty.propertyDef!.ref as string
    }

    if (listProperty.propertyDef?.dataType === 'Image') {
      modelName = 'Image'
    }

    const seedSchemaUid = await getSchemaUidForModel(
      modelName!,
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
          publishLocalId: originalSeedLocalId,
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
    itemListProperties,
    itemUploadProperties,
    itemImageProperties,
    itemRelationProperties,
  } = getSegmentedItemProperties(item)

  const relationAndImageProperties = [...itemRelationProperties, ...itemImageProperties]

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

  for (const relationProperty of relationAndImageProperties) {
    multiPublishPayload = await processRelationOrImageProperty(
      relationProperty,
      multiPublishPayload,
      uploadedTransactions,
      item.seedLocalId,
    )
    itemBasicProperties.push(relationProperty)
  }

  for (const listProperty of itemListProperties) {
    multiPublishPayload = await processListProperty(
      listProperty,
      multiPublishPayload,
      item.seedLocalId,
    )
    itemBasicProperties.push(listProperty)
  }
  
  itemPublishData = await processBasicProperties(
    itemBasicProperties,
    itemPublishData,
  )

  multiPublishPayload.push(itemPublishData)


  

  return multiPublishPayload
}
