// Dynamic import to break circular dependency with getItem -> BaseItem
// import { getItem } from '@/db/read/getItem'
import {
  defaultAttestationData,
  INTERNAL_DATA_TYPES,
  INTERNAL_PROPERTY_NAMES,
  VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
  ZERO_BYTES32,
} from '@/helpers/constants'
import {
  AttestationRequest,
  AttestationRequestData,
} from '@ethereum-attestation-service/eas-sdk'

import { getEasSchemaForItemProperty } from '@/helpers/getSchemaForItemProperty'
import { toSnakeCase } from '@/helpers'
import { toSnakeCase as toSnakeCaseDb } from 'drizzle-orm/casing'
import pluralize from 'pluralize'
import { getEasSchemaUidForModel } from './getSchemaUidForModel'
import { getEasSchemaUidForSchemaDefinition } from '@/stores/eas'
import { getCorrectId } from '@/helpers'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import { getPropertySchema } from '@/helpers/property'
import { modelPropertiesToObject } from '@/helpers/model'
import { IItemProperty } from '@/interfaces'
import { camelCase, upperFirst } from 'lodash-es'
import { BaseDb } from '@/db/Db/BaseDb'
import { models, properties, versions } from '@/seedSchema'
import { eq, and, desc } from 'drizzle-orm'
import { IItem } from '@/interfaces'
import { Item } from '@/Item/Item'
import debug from 'debug'
import {ethers} from 'ethers'
import { ModelPropertyDataTypes } from '@/Schema'
import type { ValidationError } from '@/Schema/validation'
const logger = debug('seedSdk:db:getPublishPayload')

/** Validation error collected during publish payload building. */
export type PublishValidationError = Pick<ValidationError, 'field' | 'message'> & { code?: string }

/** Context for collecting validation errors instead of throwing on first error. */
export type PublishValidationContext = { errors: PublishValidationError[] }

function addValidationError(
  ctx: PublishValidationContext,
  message: string,
  field?: string,
  code = 'publish_validation',
): void {
  ctx.errors.push({ field: field ?? '', message, code })
}

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

/**
 * Resolve versionUid when item.latestVersionUid is empty but item has been published (has seedUid).
 * Tries DB first, then EAS. The contract path never calls updateVersionUid, so the versions table
 * may have uid=NULL. EAS fallback queries attestations where refUID=seedUid (Version attestations).
 */
async function resolveVersionUid(
  seedLocalId: string,
  seedUid: string | undefined,
): Promise<string> {
  if (!seedLocalId || !seedUid || seedUid === ZERO_BYTES32) return ZERO_BYTES32

  const appDb = BaseDb.getAppDb()
  if (appDb) {
    const rows = await appDb
      .select({ uid: versions.uid })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))
      .orderBy(desc(versions.createdAt))
      .limit(1)
    const uid = rows[0]?.uid
    if (uid && uid !== '' && uid !== 'NULL') return uid
  }

  try {
    const { getItemVersionsFromEas } = await import('@/eas')
    const attestations = await getItemVersionsFromEas({ seedUids: [seedUid] })
    const latest = attestations?.[0]
    if (latest?.id) return latest.id
  } catch {
    // EAS client may not be initialized or network error
  }
  return ZERO_BYTES32
}

type PropertyDataResult = {
  schemaUid: string | undefined
  easDataType: string
  schemaDef: string
  propertyNameForSchema: string
}

const getPropertyData = async (
  itemProperty: IItemProperty<any>,
  ctx?: PublishValidationContext,
): Promise<PropertyDataResult | null> => {
  const dataType = itemProperty.propertyDef?.dataType
  const entry = dataType != null ? INTERNAL_DATA_TYPES[dataType as keyof typeof INTERNAL_DATA_TYPES] : undefined
  const easDataType = entry?.eas
  if (!easDataType) {
    if (ctx) {
      addValidationError(
        ctx,
        `Unknown or unsupported property data type "${dataType ?? 'undefined'}" for property: ${itemProperty.propertyName}. Supported types: ${Object.keys(INTERNAL_DATA_TYPES).join(', ')}.`,
        itemProperty.propertyName,
      )
    }
    return null
  }

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

/** Resolve propertyDef from Model for properties that lack it (e.g. cached instances
 * created before loadOrCreateProperty was fixed). Ensures both new and existing items get property attestations.
 * Also ensures Relation/Image properties have required from schema when missing (for publish validation). */
const ensurePropertyDefs = async (targetItem: IItem<any>) => {
  const toFix = targetItem.properties.filter(
    (p) =>
      targetItem.modelName &&
      (!p.propertyDef || (p.propertyDef?.dataType === 'Relation' && p.propertyDef?.required === undefined)),
  )
  let schema: any
  for (const itemProperty of targetItem.properties) {
    if (!itemProperty.propertyDef && targetItem.modelName) {
      schema = await getPropertySchema(targetItem.modelName, itemProperty.propertyName)
      if (!schema) {
        try {
          const { Model } = await import('@/Model/Model')
          const normalizedModelName = upperFirst(camelCase(targetItem.modelName))
          let model = Model.getByName(normalizedModelName)
          if (!model?.properties?.length) {
            model = Model.findByModelType(toSnakeCaseDb(targetItem.modelName))
          }
          const modelFound = !!model
          const propsCount = model?.properties?.length ?? 0
          const schemaKeys: string[] = []
          if (model?.properties?.length) {
            const schemas = modelPropertiesToObject(model.properties)
            schemaKeys.push(...Object.keys(schemas))
            schema = schemas[itemProperty.propertyName]
          }
        } catch (err) {
          schema = undefined
        }
      }
      if (!schema) {
        const db = BaseDb.getAppDb()
        if (db) {
          try {
            const normalizedModelName = upperFirst(camelCase(targetItem.modelName))
            const modelRecords = await db
              .select({ id: models.id })
              .from(models)
              .where(eq(models.name, normalizedModelName))
              .limit(1)
            if (modelRecords.length > 0 && modelRecords[0].id) {
              const propertyRecords = await db
                .select()
                .from(properties)
                .where(
                  and(
                    eq(properties.modelId, modelRecords[0].id),
                    eq(properties.name, itemProperty.propertyName),
                  ),
                )
                .limit(1)
              if (propertyRecords.length > 0) {
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
                schema = {
                  dataType: propRecord.dataType,
                  ref: refModelName ?? undefined,
                  refValueType: propRecord.refValueType || undefined,
                  storageType: propRecord.storageType || undefined,
                  localStorageDir: propRecord.localStorageDir || undefined,
                  filenameSuffix: propRecord.filenameSuffix || undefined,
                  required: propRecord.required ?? undefined,
                }
              }
            }
          } catch {
            schema = undefined
          }
        }
      }
      if (schema) {
        itemProperty.getService().send({
          type: 'updateContext',
          propertyRecordSchema: schema,
        })
      }
    }
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
  ctx: PublishValidationContext,
): Promise<PublishPayload> => {
  for (const basicProperty of itemBasicProperties) {
    // Skip SDK-internal properties (e.g. publisher) - never attest to EAS
    if (INTERNAL_PROPERTY_NAMES.includes(basicProperty.propertyName)) {
      continue
    }
    const snapshot = basicProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    const propertyDef =
      basicProperty.propertyDef ?? (context ? (context as any).propertyRecordSchema : undefined)
    const isFileImageHtml =
      propertyDef?.dataType === ModelPropertyDataTypes.File ||
      propertyDef?.dataType === ModelPropertyDataTypes.Image ||
      propertyDef?.dataType === ModelPropertyDataTypes.Html
    // File/Image/Html must use propertyValue (seed ID), not basicProperty.value which returns
    // renderValue (file content) for File—bytes32 can only hold 31 bytes.
    let value =
      isFileImageHtml && context
        ? (context as any).propertyValue
        : ((basicProperty as IItemProperty<any>).value ??
          (context ? (context as any).propertyValue : undefined))
    const hasContext = !!context
    const hasValue = value != null && value !== ''
    const hasUid = !!basicProperty.uid
    const skipReason = !hasContext ? 'no_context' : (!hasValue || hasUid) ? (hasUid ? 'has_uid' : 'no_value') : null
    if (!context) {
      continue
    }
    if (!value || basicProperty.uid) {
      continue
    }

    const propertyData = await getPropertyData(basicProperty, ctx)
    if (!propertyData) continue
    const { schemaUid, easDataType, schemaDef, propertyNameForSchema } = propertyData
    if (!schemaDef) continue

    // Normalize value: string that parses to array (e.g. from browser storage) -> array
    if (schemaDef.startsWith('bytes32[]') && typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        value = JSON.parse(value)
      } catch {
        // fall through to array check
      }
    }

    if (schemaDef.startsWith('bytes32[]') && !Array.isArray(value)) {
      addValidationError(
        ctx,
        `Invalid value for property: ${basicProperty.propertyName}. Expected an array of bytes32, got ${value}.`,
        basicProperty.propertyName,
      )
      continue
    }

    // Validate against property validation rules (enum, pattern, minLength, maxLength) before encoding
    if (propertyDef?.validation) {
      const { SchemaValidationService } = await import(
        '@/Schema/service/validation/SchemaValidationService'
      )
      const validationService = new SchemaValidationService()
      const validationResult = validationService.validatePropertyValue(
        value,
        propertyDef.dataType as ModelPropertyDataTypes,
        propertyDef.validation,
        propertyDef.refValueType as string | undefined,
      )
      if (!validationResult.isValid && validationResult.errors.length > 0) {
        const firstError = validationResult.errors[0]
        addValidationError(
          ctx,
          firstError.message,
          basicProperty.propertyName,
          firstError.code ?? 'publish_validation',
        )
        continue
      }
    }

    if (schemaDef.startsWith('bytes32[]')) {
      const newValues = []
      const iterableValue =
        Array.isArray(value) ? value
        : value != null && typeof value[Symbol.iterator] === 'function' ? value
        : []
      for (const seedId of iterableValue) {
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

    let encodedData: string
    try {
      const SchemaEncoder = await getSchemaEncoder()
      const dataEncoder = new SchemaEncoder(schemaDef)
      encodedData = dataEncoder.encodeData(data) as string
    } catch (encodeErr) {
      addValidationError(
        ctx,
        `Failed to encode property ${basicProperty.propertyName}: ${encodeErr instanceof Error ? encodeErr.message : String(encodeErr)}`,
        basicProperty.propertyName,
      )
      continue
    }

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
  ctx: PublishValidationContext,
): Promise<MultiPublishPayload> => {
  let relationOrImageSchemaUid = relationOrImageProperty.schemaUid
  if (!relationOrImageSchemaUid && relationOrImageProperty.propertyDef) {
    const propertyData = await getPropertyData(relationOrImageProperty, ctx)
    if (!propertyData) return multiPublishPayload
    relationOrImageSchemaUid = propertyData.schemaUid
  }
  if (!relationOrImageSchemaUid) {
    addValidationError(
      ctx,
      `Schema uid not found for relation or image property: ${relationOrImageProperty.propertyName}`,
      relationOrImageProperty.propertyName,
    )
    return multiPublishPayload
  }

  const snapshot = relationOrImageProperty.getService().getSnapshot()
  const context = 'context' in snapshot ? snapshot.context : null
  if (!context) {
    return multiPublishPayload
  }
  let value = (context as any).propertyValue
  // File/Image/Html/Json metadata is stored with Id suffix (e.g. "textId"); context may not have propertyValue
  // if the property was created from schema before metadata loaded. Fallback to metadata lookup.
  const isStorageSeed =
    relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.File ||
    relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Image ||
    relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Html ||
    relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Json ||
    (relationOrImageProperty.propertyDef?.dataType === ModelPropertyDataTypes.Relation &&
      (relationOrImageProperty.propertyDef?.refValueType === ModelPropertyDataTypes.File ||
        relationOrImageProperty.propertyDef?.refValueType === ModelPropertyDataTypes.Image ||
        relationOrImageProperty.propertyDef?.refValueType === ModelPropertyDataTypes.Html ||
        relationOrImageProperty.propertyDef?.refValueType === ModelPropertyDataTypes.Json))
  if (!value && isStorageSeed && ((context as any).seedLocalId || (context as any).seedUid)) {
    const { getPropertyData: getPropertyDataFromDb } = await import('@/db/read/getPropertyData')
    const metaRow = await getPropertyDataFromDb({
      propertyName: relationOrImageProperty.propertyName,
      seedLocalId: (context as any).seedLocalId,
      seedUid: (context as any).seedUid,
    })
    const fromMeta = metaRow?.propertyValue
    if (fromMeta && typeof fromMeta === 'string' && fromMeta.trim() !== '') {
      value = fromMeta
    }
  }
  const propertyDef = relationOrImageProperty.propertyDef
  let isRequired = propertyDef?.required === true
  // Resolve required from schema/DB when propertyDef lacks it
  if (!isRequired && relationOrImageProperty.modelName) {
    let schema = await getPropertySchema(
      relationOrImageProperty.modelName,
      relationOrImageProperty.propertyName,
    )
    if (!schema && BaseDb.getAppDb()) {
      const normalizedModelName = upperFirst(camelCase(relationOrImageProperty.modelName))
      const modelRecords = await BaseDb.getAppDb()!
        .select({ id: models.id })
        .from(models)
        .where(eq(models.name, normalizedModelName))
        .limit(1)
      if (modelRecords.length > 0 && modelRecords[0].id) {
        const propertyRecords = await BaseDb.getAppDb()!
          .select()
          .from(properties)
          .where(
            and(
              eq(properties.modelId, modelRecords[0].id),
              eq(properties.name, relationOrImageProperty.propertyName),
            ),
          )
          .limit(1)
        if (propertyRecords.length > 0) {
          schema = {
            dataType: propertyRecords[0].dataType,
            ref: undefined,
            required: propertyRecords[0].required ?? undefined,
          } as any
        }
      }
    }
    if (schema?.required === true || (schema as any)?.required === 1) {
      isRequired = true
    }
  }

  // Required relation/image/file/html/json with no value: cannot publish
  if (isRequired && !value) {
    const typeLabel =
      propertyDef?.dataType === ModelPropertyDataTypes.File ||
      propertyDef?.refValueType === ModelPropertyDataTypes.File
        ? 'file'
        : propertyDef?.dataType === ModelPropertyDataTypes.Image ||
            propertyDef?.refValueType === ModelPropertyDataTypes.Image
          ? 'image'
          : propertyDef?.dataType === ModelPropertyDataTypes.Html ||
              propertyDef?.refValueType === ModelPropertyDataTypes.Html
            ? 'html'
            : propertyDef?.dataType === ModelPropertyDataTypes.Json ||
                propertyDef?.refValueType === ModelPropertyDataTypes.Json
              ? 'json'
              : 'relation'
    const refLabel = propertyDef?.ref ?? propertyDef?.refModelName ?? 'related'
    addValidationError(
      ctx,
      `Required ${typeLabel} ${relationOrImageProperty.propertyName} has no value. ` +
        `A value pointing to a valid ${refLabel} item is required to publish.`,
      relationOrImageProperty.propertyName,
    )
    return multiPublishPayload
  }

  if (!value || relationOrImageProperty.uid) {
    return multiPublishPayload
  }

  const { localId: seedLocalId, uid: seedUid } = getCorrectId(value)

  // Value is not a valid seed reference (10-char localId or 66-char uid)
  if (!seedLocalId && !seedUid) {
    if (isRequired) {
      addValidationError(
        ctx,
        `Required relation ${relationOrImageProperty.propertyName} has invalid value: ${JSON.stringify(value)}. ` +
          `Value must be a valid seed reference (localId or uid) pointing to a ${propertyDef?.ref ?? propertyDef?.refModelName ?? 'related'} item.`,
        relationOrImageProperty.propertyName,
      )
    }
    return multiPublishPayload
  }

  // Use dynamic import to break circular dependency
  const getItemMod = await import('../../db/read/getItem')
  const { getItem } = getItemMod
  const relatedItem = await getItem({
    seedLocalId,
    seedUid,
  })

  // When related item not found (e.g. different DB, not yet created)
  if (!relatedItem) {
    if (isRequired) {
      addValidationError(
        ctx,
        `No related item found for required relation: ${relationOrImageProperty.propertyName}. ` +
          `Value: ${JSON.stringify(value)} (seedLocalId/seedUid). ` +
          `The related item may be missing, in a different database, or the reference may be broken.`,
        relationOrImageProperty.propertyName,
      )
    }
    return multiPublishPayload
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
    addValidationError(
      ctx,
      `Model name not found for relation or image property: ${relationOrImageProperty.propertyName}`,
      relationOrImageProperty.propertyName,
    )
    return multiPublishPayload
  }

  const seedSchemaUid = await getEasSchemaUidForModel(modelName)
  
  if (!seedSchemaUid) {
    addValidationError(
      ctx,
      `Schema UID not found for model: ${modelName}`,
      relationOrImageProperty.propertyName,
    )
    return multiPublishPayload
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

  await ensurePropertyDefs(relatedItem)
  const { itemBasicProperties, itemUploadProperties } =
    await getSegmentedItemProperties(relatedItem)

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
    ctx,
  )

  multiPublishPayload.push(publishPayload)

  return multiPublishPayload
}

const processListProperty = async (
  listProperty: IItemProperty<any>,
  multiPublishPayload: MultiPublishPayload,
  originalSeedLocalId: string,
  ctx: PublishValidationContext,
): Promise<MultiPublishPayload> => {
  // processListProperty only handles list-of-relations; list-of-primitives go to itemBasicProperties
  if (!listProperty.propertyDef?.ref) {
    addValidationError(
      ctx,
      `processListProperty requires ref (list of relations). List property "${listProperty.propertyName}" has no ref. List-of-primitives should be in itemBasicProperties.`,
      listProperty.propertyName,
    )
    return multiPublishPayload
  }
  let listPropertySchemaUid = listProperty.schemaUid
  if (!listPropertySchemaUid && listProperty.propertyDef) {
    const propertyData = await getPropertyData(listProperty, ctx)
    if (!propertyData) return multiPublishPayload
    listPropertySchemaUid = propertyData.schemaUid
  }
  if (!listPropertySchemaUid) {
    addValidationError(
      ctx,
      `Schema uid not found for list property: ${listProperty.propertyName}`,
      listProperty.propertyName,
    )
    return multiPublishPayload
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

  const iterableValue = Array.isArray(value)
    ? value
    : value != null
      ? [value]
      : []

  for (const seedId of iterableValue) {
    const idStr =
      typeof seedId === 'string'
        ? seedId
        : seedId &&
          typeof seedId === 'object' &&
          (seedId.seedLocalId ?? seedId.seedUid ?? seedId.localId ?? seedId.uid)
    if (!idStr) continue
    const { localId: seedLocalId, uid: seedUid } = getCorrectId(idStr)
    if (!seedLocalId && !seedUid) continue

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
      continue
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
      addValidationError(
        ctx,
        `Model name not found for list property: ${listProperty.propertyName}`,
        listProperty.propertyName,
      )
      continue
    }

    const seedSchemaUid = await getEasSchemaUidForModel(modelName)
    
    if (!seedSchemaUid) {
      addValidationError(
        ctx,
        `Schema UID not found for model: ${modelName}`,
        listProperty.propertyName,
      )
      continue
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

    await ensurePropertyDefs(relatedItem)
    const { itemBasicProperties } = await getSegmentedItemProperties(relatedItem)

    publishPayload = await processBasicProperties(
      itemBasicProperties,
      publishPayload,
      ctx,
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

/** Error thrown when publish validation fails. Includes all validation errors for user to fix. */
export class PublishValidationFailedError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: PublishValidationError[],
  ) {
    super(message)
    this.name = 'PublishValidationFailedError'
  }
}

export const getPublishPayload = async (
  item: Item<any>,
  uploadedTransactions: UploadedTransaction[],
): Promise<MultiPublishPayload> => {
  const validationCtx: PublishValidationContext = { errors: [] }

  let multiPublishPayload: MultiPublishPayload = []

  // Each PublishPayload is generated from a Seed that needs publishing

  // First we need to determine all Seeds to publish

  // That means the Seed of the Item, plus any Seeds pointed to by Relations

  // Check if the item has a schema UID
  let itemSchemaUid = item.schemaUid
  if (!itemSchemaUid) {
    const schemaUid = await getEasSchemaUidForModel(item.modelName)
    if (!schemaUid) {
      addValidationError(validationCtx, `Schema UID not found for model: ${item.modelName}`)
      itemSchemaUid = ZERO_BYTES32 // placeholder so we can continue collecting errors
    } else {
      itemSchemaUid = schemaUid
    }
  }

  let versionUid = getVersionUid(item)
  if (versionUid === ZERO_BYTES32 && item.seedUid && item.seedUid !== ZERO_BYTES32) {
    versionUid = await resolveVersionUid(item.seedLocalId, item.seedUid)
  }

  let itemPublishData: PublishPayload = {
    localId: item.seedLocalId,
    seedUid: item.seedUid || ZERO_BYTES32,
    seedIsRevocable: true,
    seedSchemaUid: itemSchemaUid,
    versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
    versionUid,
    listOfAttestations: [],
    propertiesToUpdate: [],
  }

  await ensurePropertyDefs(item)

  const {
    itemBasicProperties,
    itemListProperties,
    itemUploadProperties,
    itemImageProperties,
    itemRelationProperties,
  } = await getSegmentedItemProperties(item)

  const relationAndImageProperties = [...itemRelationProperties, ...itemImageProperties]

  // Validate required relations have values before processing
  for (const relProp of itemRelationProperties) {
    const snapshot = relProp.getService().getSnapshot()
    const ctx = 'context' in snapshot ? snapshot.context : null
    const val = ctx ? (ctx as any).renderValue ?? (ctx as any).propertyValue : undefined
    if (val != null && typeof val === 'string' && val.trim() !== '') continue
    // No value - check if required from propertyDef or DB
    let isRequired = relProp.propertyDef?.required === true
    if (!isRequired && BaseDb.getAppDb() && item.modelName) {
      const normalizedModelName = upperFirst(camelCase(item.modelName))
      const modelRows = await BaseDb.getAppDb()!
        .select({ id: models.id })
        .from(models)
        .where(eq(models.name, normalizedModelName))
        .limit(1)
      if (modelRows.length > 0) {
        const propRows = await BaseDb.getAppDb()!
          .select({ required: properties.required, refModelId: properties.refModelId })
          .from(properties)
          .where(
            and(
              eq(properties.modelId, modelRows[0].id),
              eq(properties.name, relProp.propertyName),
              eq(properties.dataType, 'Relation'),
            ),
          )
          .limit(1)
        if (propRows.length > 0 && (propRows[0].required === true || propRows[0].required === 1)) {
          isRequired = true
        }
      }
    }
    if (isRequired) {
      const refModel = relProp.propertyDef?.ref ?? relProp.propertyDef?.refModelName ?? 'related'
      addValidationError(
        validationCtx,
        `Required relation ${relProp.propertyName} has no value. ` +
          `A value pointing to a valid ${refModel} item is required to publish.`,
        relProp.propertyName,
      )
    }
  }

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
      validationCtx,
    )
    itemBasicProperties.push(relationProperty)
  }

  for (const listProperty of itemListProperties) {
    multiPublishPayload = await processListProperty(
      listProperty,
      multiPublishPayload,
      item.seedLocalId,
      validationCtx,
    )
    itemBasicProperties.push(listProperty)
  }

  itemPublishData = await processBasicProperties(
    itemBasicProperties,
    itemPublishData,
    validationCtx,
  )

  multiPublishPayload.push(itemPublishData)

  // Ensure requests are ordered so that when A has propertiesToUpdate pointing to B (publishLocalId),
  // A (the updater) is published before B (the updatee). The contract injects A's seedUid into B's
  // attestation before B is sent to EAS.
  multiPublishPayload = orderPayloadByDependencies(multiPublishPayload)

  // Ensure attestations referenced in propertiesToUpdate have at least one data element.
  // The contract writes the seed UID into data[0].data; empty data causes Panic 50.
  multiPublishPayload = ensurePropertiesToUpdateAttestationsHaveData(multiPublishPayload)

  if (validationCtx.errors.length > 0) {
    const combinedMessage = validationCtx.errors.map((e) => e.message).join('\n')
    throw new PublishValidationFailedError(
      `Validation failed (${validationCtx.errors.length} error${validationCtx.errors.length === 1 ? '' : 's'}):\n${combinedMessage}`,
      validationCtx.errors,
    )
  }

  return multiPublishPayload
}

export type ValidateItemForPublishResult = {
  isValid: boolean
  errors: PublishValidationError[]
}

/**
 * Validates an item for publishing without performing Arweave or EAS work.
 * Use in the checking step to fail fast before creating transactions.
 * Pass empty array for uploadedTransactions when validating before Arweave upload.
 */
export const validateItemForPublish = async (
  item: Item<any>,
  uploadedTransactions: UploadedTransaction[] = [],
): Promise<ValidateItemForPublishResult> => {
  try {
    await getPublishPayload(item, uploadedTransactions)
    return { isValid: true, errors: [] }
  } catch (err) {
    if (err instanceof PublishValidationFailedError) {
      return { isValid: false, errors: err.validationErrors }
    }
    throw err
  }
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
