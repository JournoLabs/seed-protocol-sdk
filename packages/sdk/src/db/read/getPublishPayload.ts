// Dynamic import to break circular dependency with getItem -> BaseItem
// import { getItem } from '@/db/read/getItem'
import {
  defaultAttestationData,
  INTERNAL_DATA_TYPES,
  VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
  ZERO_BYTES32,
} from '@/helpers/constants'
import {
  AttestationRequest,
  AttestationRequestData,
} from '@ethereum-attestation-service/eas-sdk'

import { getEasSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { toSnakeCase } from '@/helpers'
import pluralize from 'pluralize'
import { getEasSchemaUidForModel } from './getSchemaUidForModel'
import { getEasSchemaUidForSchemaDefinition } from '@/stores/eas'
import { getCorrectId } from '@/helpers'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import { IItemProperty } from '@/interfaces'
import { IItem } from '@/interfaces'
import { Item } from '@/Item/Item'
import debug from 'debug'
import {ethers} from 'ethers'
import { ModelPropertyDataTypes } from '@/Schema'
const logger = debug('seedSdk:db:getPublishPayload')

const getVersionUid = (item: IItem<any>): string => {
  const latestVersion = item.latestVersionUid
  if (latestVersion && typeof latestVersion === 'object' && latestVersion.uid) {
    return latestVersion.uid
  }
  if (latestVersion && typeof latestVersion === 'string') {
    return latestVersion
  }
  return ZERO_BYTES32
}

const getPropertyData = async (itemProperty: IItemProperty<any>) => {
  const easDataType =
    INTERNAL_DATA_TYPES[itemProperty.propertyDef!.dataType].eas

  let schemaUid: string | undefined = itemProperty.schemaUid

  const propertyNameForSchema = toSnakeCase(itemProperty.propertyName)

  const schemaDef = `${easDataType} ${propertyNameForSchema}`

  if (!schemaUid) {
    schemaUid = await getEasSchemaUidForSchemaDefinition({ schemaText: schemaDef })
    if (!schemaUid) {
      const schema = await getEasSchemaForItemProperty({
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

// Lazy import SchemaEncoder to avoid module resolution issues with ts-import
let SchemaEncoderClass: typeof import('@ethereum-attestation-service/eas-sdk').SchemaEncoder | null = null
const getSchemaEncoder = async () => {
  if (!SchemaEncoderClass) {
    const easSdk = await import('@ethereum-attestation-service/eas-sdk')
    SchemaEncoderClass = easSdk.SchemaEncoder
  }
  return SchemaEncoderClass
}

const processBasicProperties = async (
  itemBasicProperties: IItemProperty<any>[],
  itemPublishData: PublishPayload,
): Promise<PublishPayload> => {
  for (const basicProperty of itemBasicProperties) {
    const snapshot = basicProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) {
      continue
    }
    let value = (context as any).propertyValue

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

    // uint256 (Date) must be numeric/BigInt; normalize ISO strings to Unix seconds
    if (easDataType === 'uint256' && (typeof value === 'string' || value instanceof Date)) {
      const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
      value = BigInt(Math.floor(ms / 1000))
    }

    let data = [
      {
        name: propertyNameForSchema,
        type: easDataType,
        value,
      },
    ]

    const SchemaEncoder = await getSchemaEncoder()
    const dataEncoder = new SchemaEncoder(schemaDef)

    const encodedData = dataEncoder.encodeData(data)

    // For storageTransactionId, set refUID to versionUid so it references the Version attestation (contract may use when supported)
    const refUid =
      basicProperty.propertyName === 'storageTransactionId'
        ? itemPublishData.versionUid
        : defaultAttestationData.refUID

    const attestationEntry: Omit<AttestationRequest, 'data'> & {
      data: AttestationRequestData[]
      _propertyName?: string
      _schemaDef?: string
      _unresolvedValue?: string
      _easDataType?: string
    } = {
      schema: schemaUid!,
      data: [
        {
          ...defaultAttestationData,
          refUID: refUid,
          data: encodedData,
        } as AttestationRequestData,
      ],
    }

    // For relation/image properties with seedLocalId, store resolution hints for resolvePublishPayloadValues
    if (
      typeof value === 'string' &&
      value.length === 10 &&
      (easDataType === 'bytes32' || easDataType === 'string')
    ) {
      attestationEntry._propertyName = basicProperty.propertyName
      attestationEntry._schemaDef = schemaDef
      attestationEntry._unresolvedValue = value
      attestationEntry._easDataType = easDataType
    }

    itemPublishData.listOfAttestations.push(attestationEntry)
  }

  return itemPublishData
}


const processRelationOrImageProperty = async (
  relationOrImageProperty: IItemProperty<any>,
  multiPublishPayload: MultiPublishPayload,
  uploadedTransactions: UploadedTransaction[],
  originalSeedLocalId: string,
): Promise<MultiPublishPayload> => {
  let relationOrImageSchemaUid = relationOrImageProperty.schemaUid
  if (!relationOrImageSchemaUid && relationOrImageProperty.propertyDef) {
    const propertyData = await getPropertyData(relationOrImageProperty)
    relationOrImageSchemaUid = propertyData.schemaUid
  }
  if (!relationOrImageSchemaUid) {
    throw new Error(
      `Schema uid not found for relation or image property: ${relationOrImageProperty.propertyName}`,
    )
  }

  const snapshot = relationOrImageProperty.getService().getSnapshot()
  const context = 'context' in snapshot ? snapshot.context : null
  if (!context) {
    return multiPublishPayload
  }
  const value = (context as any).propertyValue
  if (!value || relationOrImageProperty.uid) {
    return multiPublishPayload
  }

  const { localId: seedLocalId, uid: seedUid } = getCorrectId(value)

  // Value is not a valid seed reference (10-char localId or 66-char uid); skip (e.g. Html with inline content)
  if (!seedLocalId && !seedUid) {
    return multiPublishPayload
  }

  // Use dynamic import to break circular dependency
  const getItemMod = await import('../../db/read/getItem')
  const { getItem } = getItemMod
  const relatedItem = await getItem({
    seedLocalId,
    seedUid,
  })

  if (!relatedItem) {
    throw new Error(
      `No related item found for relation or image property: ${relationOrImageProperty.propertyName}`,
    )
  }

  // When Image/Relation already has seedUid (published), skip creating its payload—only add the property to parent
  if (relatedItem.seedUid) {
    return multiPublishPayload
  }

  const versionUid = getVersionUid(relatedItem)

  let modelName: string | undefined

  if (relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Image) {
    modelName = 'Image'
  }

  if (relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.File) {
    modelName = 'File'
  }

  if (relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Html) {
    modelName = 'Html'
  }

  if (relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Relation) {
    const def = relationOrImageProperty.propertyDef as { ref?: string; refModelName?: string }
    modelName = def.ref ?? def.refModelName
  }

  if (!modelName) {
    throw new Error(`Model name not found for relation or image property: ${relationOrImageProperty.propertyName}`)
  }

  const seedSchemaUid = await getEasSchemaUidForModel(modelName)
  
  if (!seedSchemaUid) {
    throw new Error(`Schema UID not found for model: ${modelName}`)
  }

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
        propertySchemaUid: relationOrImageSchemaUid,
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
  // processListProperty only handles list-of-relations; list-of-primitives go to itemBasicProperties
  if (!listProperty.propertyDef?.ref) {
    throw new Error(
      `processListProperty requires ref (list of relations). List property "${listProperty.propertyName}" has no ref. List-of-primitives should be in itemBasicProperties.`,
    )
  }
  let listPropertySchemaUid = listProperty.schemaUid
  if (!listPropertySchemaUid && listProperty.propertyDef) {
    const propertyData = await getPropertyData(listProperty)
    listPropertySchemaUid = propertyData.schemaUid
  }
  if (!listPropertySchemaUid) {
    throw new Error(
      `Schema uid not found for list property: ${listProperty.propertyName}`,
    )
  }

  const snapshot = listProperty.getService().getSnapshot()
  const context = 'context' in snapshot ? snapshot.context : null
  if (!context) {
    return multiPublishPayload
  }
  let value = (context as any).propertyValue
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

    // Use dynamic import to break circular dependency
    const getItemMod = await import('../../db/read/getItem')
    const { getItem } = getItemMod
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

    let modelName: string | undefined

    if (listProperty.propertyDef?.ref || (listProperty.propertyDef as { refModelName?: string }).refModelName) {
      const def = listProperty.propertyDef as { ref?: string; refModelName?: string }
      modelName = def.ref ?? def.refModelName
    }

    if (listProperty.propertyDef?.dataType === ModelPropertyDataTypes.Image) {
      modelName = 'Image'
    }

    if (listProperty.propertyDef?.dataType === ModelPropertyDataTypes.File) {
      modelName = 'File'
    }

    if (listProperty.propertyDef?.dataType === ModelPropertyDataTypes.Html) {
      modelName = 'Html'
    }

    if (!modelName) {
      throw new Error(`Model name not found for list property: ${listProperty.propertyName}`)
    }

    const seedSchemaUid = await getEasSchemaUidForModel(modelName)
    
    if (!seedSchemaUid) {
      throw new Error(`Schema UID not found for model: ${modelName}`)
    }

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
          propertySchemaUid: listPropertySchemaUid,
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
  listOfAttestations: (Omit<AttestationRequest, 'data'> & {
    data: AttestationRequestData[]
    _propertyName?: string
    _schemaDef?: string
    _unresolvedValue?: string
  })[]
  propertiesToUpdate: any[]
}

type MultiPublishPayload = PublishPayload[]

/** Map of seed localId -> attestation uid for resolving relation/image property values after dependent seeds are published */
export type ResolvedSeedUids = Record<string, string>

type UploadedTransaction = {
  txId: string
  itemPropertyLocalId?: string
  seedLocalId?: string
  versionLocalId?: string
  itemPropertyName?: string
}

export const getPublishPayload = async (
  item: Item<any>,
  uploadedTransactions: UploadedTransaction[],
): Promise<MultiPublishPayload> => {

  let multiPublishPayload: MultiPublishPayload = []

  // Each PublishPayload is generated from a Seed that needs publishing

  // First we need to determine all Seeds to publish

  // That means the Seed of the Item, plus any Seeds pointed to by Relations

  // Check if the item has a schema UID
  let itemSchemaUid = item.schemaUid
  if (!itemSchemaUid) {
    const schemaUid = await getEasSchemaUidForModel(item.modelName)
    if (!schemaUid) {
      throw new Error(`Schema UID not found for model: ${item.modelName}`)
    }
    itemSchemaUid = schemaUid
  }

  let itemPublishData: PublishPayload = {
    localId: item.seedLocalId,
    seedUid: item.seedUid || ZERO_BYTES32,
    seedIsRevocable: true,
    seedSchemaUid: itemSchemaUid,
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

  // Ensure requests are ordered so that when A has propertiesToUpdate pointing to B (publishLocalId),
  // A (the updater) is published before B (the updatee). The contract injects A's seedUid into B's
  // attestation before B is sent to EAS.
  multiPublishPayload = orderPayloadByDependencies(multiPublishPayload)

  // Ensure attestations referenced in propertiesToUpdate have at least one data element.
  // The contract writes the seed UID into data[0].data; empty data causes Panic 50.
  multiPublishPayload = ensurePropertiesToUpdateAttestationsHaveData(multiPublishPayload)

  return multiPublishPayload
}

/**
 * Normalize a schema UID to 0x-prefixed 64-char hex for comparison.
 */
function normalizeSchemaUid(v: string | undefined): string {
  if (v == null || v === '') return ''
  const raw = v.startsWith('0x') ? v.slice(2) : v
  const hex = raw.replace(/[^0-9a-fA-F]/g, '0').padStart(64, '0').slice(-64)
  return ('0x' + hex).toLowerCase()
}

/**
 * Ensure that when request A has propertiesToUpdate with (publishLocalId: B, propertySchemaUid: X),
 * request B has an attestation for schema X with at least one data element. The contract writes
 * the seed UID into data[0].data; empty data causes Panic 50.
 */
function ensurePropertiesToUpdateAttestationsHaveData(
  payload: MultiPublishPayload,
): MultiPublishPayload {
  const byLocalId = new Map<string, PublishPayload>()
  for (const p of payload) {
    byLocalId.set(p.localId, p)
  }

  const placeholderData: AttestationRequestData = {
    ...defaultAttestationData,
    data: ZERO_BYTES32,
  }

  for (const req of payload) {
    for (const pu of req.propertiesToUpdate ?? []) {
      const targetId = (pu as { publishLocalId?: string }).publishLocalId
      const schemaUid = (pu as { propertySchemaUid?: string }).propertySchemaUid
      if (!targetId || !schemaUid) continue

      const targetReq = byLocalId.get(targetId)
      if (!targetReq?.listOfAttestations) continue

      const wantSchema = normalizeSchemaUid(schemaUid)
      const att = targetReq.listOfAttestations.find(
        (a) => normalizeSchemaUid(a?.schema) === wantSchema,
      )
      if (!att) continue

      if (!Array.isArray(att.data) || att.data.length === 0) {
        att.data = [placeholderData]
      }
    }
  }

  return payload
}

/**
 * Topological sort: when request A has propertiesToUpdate with publishLocalId B,
 * A (the updater) must appear before B (the updatee). The contract injects A's seedUid
 * into B's attestation before B is sent to EAS; if B is processed first, B's attestation
 * goes out with wrong data (string instead of bytes32).
 */
function orderPayloadByDependencies(payload: MultiPublishPayload): MultiPublishPayload {
  const byLocalId = new Map<string, PublishPayload>()
  for (const p of payload) {
    byLocalId.set(p.localId, p)
  }
  const visited = new Set<string>()
  const result: PublishPayload[] = []

  const visit = (localId: string) => {
    if (visited.has(localId)) return
    visited.add(localId)
    const p = byLocalId.get(localId)
    if (!p) return
    result.push(p)
    for (const u of p.propertiesToUpdate ?? []) {
      const targetId = (u as { publishLocalId?: string }).publishLocalId
      if (targetId && targetId !== localId) visit(targetId)
    }
  }

  for (const p of payload) {
    visit(p.localId)
  }
  return result
}

/**
 * Resolves relation/image property values (seedLocalId) to attestation uids after dependent seeds are published.
 * Call after each payload is published, passing the returned attestation uid for that seed's localId.
 * Returns an updated multiPayload with re-encoded attestations where resolution was applied.
 */
export const resolvePublishPayloadValues = async (
  multiPayload: MultiPublishPayload,
  resolvedUids: ResolvedSeedUids,
): Promise<MultiPublishPayload> => {
  if (Object.keys(resolvedUids).length === 0) {
    return multiPayload
  }

  const SchemaEncoder = await getSchemaEncoder()
  const result: MultiPublishPayload = []

  for (const payload of multiPayload) {
    const updatedAttestations: PublishPayload['listOfAttestations'] = []

    for (const attestation of payload.listOfAttestations) {
      const entry = attestation as PublishPayload['listOfAttestations'][0] & {
        _easDataType?: string
        data?: AttestationRequestData[] | AttestationRequestData
      }

      const resolvedUid = entry._unresolvedValue && resolvedUids[entry._unresolvedValue]
      if (resolvedUid && entry._schemaDef && entry._propertyName) {
        const propertyNameForSchema = toSnakeCase(entry._propertyName)
        const dataEncoder = new SchemaEncoder(entry._schemaDef)
        const encodedData = dataEncoder.encodeData([
          {
            name: propertyNameForSchema,
            type: (entry._easDataType as 'bytes32' | 'string') || 'bytes32',
            value: resolvedUid,
          },
        ])
        const baseData = Array.isArray(entry.data) ? entry.data[0] : (entry.data as AttestationRequestData)
        updatedAttestations.push({
          ...entry,
          data: [
            {
              ...baseData,
              data: encodedData,
            } as AttestationRequestData,
          ],
          _unresolvedValue: undefined,
        })
      } else {
        const normalizedEntry: PublishPayload['listOfAttestations'][0] = {
          ...entry,
          data: Array.isArray(entry.data) ? entry.data : [entry.data as AttestationRequestData],
        }
        updatedAttestations.push(normalizedEntry)
      }
    }

    result.push({
      ...payload,
      listOfAttestations: updatedAttestations,
    })
  }

  return result
}
