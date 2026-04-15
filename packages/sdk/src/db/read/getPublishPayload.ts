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
import { isValidEasAttestationUid } from '@/helpers/easUid'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import {
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@/helpers/relationSeedRef'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import { getPropertySchema } from '@/helpers/property'
import { modelPropertiesToObject } from '@/helpers/model'
import { IItemProperty } from '@/interfaces'
import { camelCase, upperFirst } from 'lodash-es'
import { BaseDb } from '@/db/Db/BaseDb'
import { models, properties } from '@/seedSchema'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { eq, and } from 'drizzle-orm'
import { IItem } from '@/interfaces'
import debug from 'debug'
import {ethers} from 'ethers'
import { ModelPropertyDataTypes } from '@/Schema'
import type { ValidationError } from '@/Schema/validation'
const logger = debug('seedSdk:db:getPublishPayload')

/** Validation error collected during publish payload building. */
export type PublishValidationError = Pick<ValidationError, 'field' | 'message'> & { code?: string }

/** Context for collecting validation errors instead of throwing on first error. */
export type PublishValidationContext = { errors: PublishValidationError[] }

/** `patch` (default): new property attestations on the current Version. `new_version`: new Version attestation + attest all properties. */
export type PublishMode = 'patch' | 'new_version'

export type GetPublishPayloadOptions = {
  publishMode?: PublishMode
}

function addValidationError(
  ctx: PublishValidationContext,
  message: string,
  field?: string,
  code = 'publish_validation',
): void {
  ctx.errors.push({ field: field ?? '', message, code })
}

function isStorageTransactionPropertyName(name: string | undefined): boolean {
  return name === 'storageTransactionId' || name === 'storage_transaction_id'
}

/**
 * Segmentation or naming variants can leave two rows for the same logical field; keep one
 * resolved slot so processBasicProperties emits a single storage tx attestation.
 */
function replaceStorageTransactionInBasicProperties(
  itemBasicProperties: IItemProperty<any>[],
  resolved: IItemProperty<any>,
): void {
  const filtered = itemBasicProperties.filter(
    (p) => !isStorageTransactionPropertyName(p.propertyName),
  )
  itemBasicProperties.length = 0
  itemBasicProperties.push(...filtered, resolved)
}

/** If multiple storageTransactionId ItemProperty rows slipped in, keep one (last wins). */
function dedupeOneStorageTransactionPropertyInList(itemBasicProperties: IItemProperty<any>[]): void {
  const nonStorage: IItemProperty<any>[] = []
  const storage: IItemProperty<any>[] = []
  for (const p of itemBasicProperties) {
    if (isStorageTransactionPropertyName(p.propertyName)) {
      storage.push(p)
    } else {
      nonStorage.push(p)
    }
  }
  if (storage.length <= 1) return
  itemBasicProperties.length = 0
  itemBasicProperties.push(...nonStorage, storage[storage.length - 1]!)
}

/**
 * Two relation/image props (e.g. content + featureImage) can reference the same File/Image seed.
 * Only one child PublishPayload should exist per related seedLocalId; merge propertiesToUpdate instead.
 */
function mergeChildPublishPayloadIfDuplicateInBatch(
  multiPublishPayload: MultiPublishPayload,
  relatedSeedLocalId: string,
  publishLocalId: string,
  propertySchemaUid: string | undefined,
): boolean {
  const existing = multiPublishPayload.find((p) => p.localId === relatedSeedLocalId)
  if (!existing) return false
  const pts = existing.propertiesToUpdate ?? []
  const already = pts.some(
    (e) =>
      e.publishLocalId === publishLocalId &&
      String(e.propertySchemaUid ?? '').toLowerCase() ===
        String(propertySchemaUid ?? '').toLowerCase(),
  )
  if (!already) {
    pts.push({ publishLocalId, propertySchemaUid })
  }
  return true
}

const getVersionUid = (item: IItem<any>): string => {
  const latestVersion = item.latestVersionUid
  if (latestVersion && typeof latestVersion === 'object' && latestVersion.uid) {
    const u = latestVersion.uid
    return isValidEasAttestationUid(u) ? u : ZERO_BYTES32
  }
  if (latestVersion && typeof latestVersion === 'string') {
    return isValidEasAttestationUid(latestVersion) ? latestVersion : ZERO_BYTES32
  }
  return ZERO_BYTES32
}

/**
 * Resolve versionUid when item.latestVersionUid is empty but item has been published (has seedUid).
 * Tries DB first, then EAS. If the local versions row still has a placeholder uid after publish,
 * EAS fallback queries attestations where refUID=seedUid (Version attestations).
 */
async function resolveVersionUid(
  seedLocalId: string,
  seedUid: string | undefined,
): Promise<string> {
  if (!seedLocalId || !seedUid || seedUid === ZERO_BYTES32) return ZERO_BYTES32

  const published = await getLatestPublishedVersionRow(seedLocalId)
  if (published?.uid) return published.uid

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

  const ip = itemProperty as IItemProperty<any> & { storagePropertyName?: string }
  const propertyDefForName = itemProperty.propertyDef as
    | { dataType?: string; ref?: string; refModelName?: string }
    | undefined
  let nameForEas =
    ip.storagePropertyName && ip.storagePropertyName.length > 0
      ? ip.storagePropertyName
      : itemProperty.propertyName
  // Align List-of-relation EAS field name with processListProperty (authorIdentityIds for authors → Identity)
  if (
    propertyDefForName?.dataType === ModelPropertyDataTypes.List &&
    (propertyDefForName.ref || propertyDefForName.refModelName) &&
    !(ip.storagePropertyName && ip.storagePropertyName.length > 0)
  ) {
    const ref = propertyDefForName.ref ?? propertyDefForName.refModelName
    if (ref) {
      const singular = pluralize.singular(itemProperty.propertyName)
      nameForEas = `${singular}${ref}Ids`
    }
  }
  const propertyNameForSchema = toSnakeCase(nameForEas)

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

type PublishBuildOpts = { forceFullSnapshot?: boolean }

const processBasicProperties = async (
  itemBasicProperties: IItemProperty<any>[],
  itemPublishData: PublishPayload,
  ctx: PublishValidationContext,
  buildOpts?: PublishBuildOpts,
): Promise<PublishPayload> => {
  const forceFullSnapshot = buildOpts?.forceFullSnapshot === true
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
    const isJsonStorage =
      propertyDef?.dataType === ModelPropertyDataTypes.Json ||
      propertyDef?.refValueType === ModelPropertyDataTypes.Json
    const isRelation = propertyDef?.dataType === ModelPropertyDataTypes.Relation
    // storageTransactionId is usually Text in the schema; .value still prefers renderValue (URL, label).
    const isStorageTransactionIdProp = isStorageTransactionPropertyName(basicProperty.propertyName)
    // File/Image/Html + Relation + Json storage + storage tx id: use propertyValue (canonical).
    // basicProperty.value prefers renderValue (filename, blob URL, display text)—never use that for publish.
    const preferPropertyValueForPublish =
      isFileImageHtml || isRelation || isJsonStorage || isStorageTransactionIdProp
    let value =
      preferPropertyValueForPublish && context
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
    // Relation + Image/File/Html/Json refs often expose seedLocalId on context.propertyValue while .value is an object — align for encode + resolve hints
    if (
      propertyDef?.dataType === ModelPropertyDataTypes.Relation ||
      isFileImageHtml ||
      isJsonStorage
    ) {
      const pv = (context as any).propertyValue
      if (typeof value === 'object' || value == null) {
        if (typeof pv === 'string' && pv.trim()) value = pv.trim()
        else if (pv && typeof pv === 'object' && typeof pv.seedLocalId === 'string') value = pv.seedLocalId
      }
    }
    if (!value) {
      continue
    }
    // Patch mode skips properties that already have an EAS uid. storageTransactionId must still
    // attest after Arweave upload when we have a tx id; metadata uid can be stale or set without a chain attestation.
    if (basicProperty.uid && !forceFullSnapshot) {
      const allowStorageTxAttestation =
        isStorageTransactionIdProp &&
        typeof value === 'string' &&
        value.trim() !== ''
      if (!allowStorageTxAttestation) {
        continue
      }
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

    // Legacy comma-separated ids (pre-JSON List storage)
    if (
      schemaDef.startsWith('bytes32[]') &&
      typeof value === 'string' &&
      !value.trim().startsWith('[') &&
      value.includes(',')
    ) {
      value = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
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

    /** Raw id per list slot (nanoid local id or 0x… uid) for resolvePublishPayloadValues after sequential publish */
    let rawListIdsForResolve: string[] | undefined
    if (schemaDef.startsWith('bytes32[]')) {
      const newValues: string[] = []
      const rawIds: string[] = []
      const iterableValue =
        Array.isArray(value) ? value
        : value != null && typeof value[Symbol.iterator] === 'function' ? value
        : []
      for (const seedId of iterableValue) {
        const idStr =
          typeof seedId === 'string'
            ? seedId
            : seedId &&
                typeof seedId === 'object' &&
                (seedId.seedLocalId ?? seedId.seedUid ?? seedId.localId ?? seedId.uid)
              ? String(
                  (seedId as { seedLocalId?: string; seedUid?: string }).seedLocalId ??
                    (seedId as { seedUid?: string }).seedUid ??
                    '',
                )
              : ''
        if (!idStr) continue
        const trimmed = idStr.trim()
        if (!trimmed) continue
        rawIds.push(trimmed)
        if (trimmed.length !== 66 && !trimmed.startsWith('0x')) {
          newValues.push(ethers.encodeBytes32String(trimmed))
        } else {
          newValues.push(trimmed)
        }
      }
      value = newValues
      const needsUidResolve = rawIds.some(
        (id) => id.length !== 66 || !id.startsWith('0x'),
      )
      if (needsUidResolve && rawIds.length > 0) {
        rawListIdsForResolve = rawIds
      }
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
    const refUid = isStorageTransactionIdProp
      ? itemPublishData.versionUid
      : defaultAttestationData.refUID

    const attestationEntry: Omit<AttestationRequest, 'data'> & {
      data: AttestationRequestData[]
      _propertyName?: string
      /** Same as encode step (getPropertyData); resolvePublishPayloadValues must use this, not toSnakeCase(propertyName). */
      _propertyNameForSchema?: string
      _schemaDef?: string
      _unresolvedValue?: string
      _easDataType?: string
      /** Per-slot raw ids (local or 0x) before encodeBytes32String; re-encoded after sequential publish. */
      _rawListIdsForResolve?: string[]
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
    const looksLikeLocalSeedRef =
      typeof value === 'string' &&
      !value.startsWith('0x') &&
      value.length !== 66 &&
      /^[a-zA-Z0-9_-]{10,21}$/.test(value.trim())
    if (
      looksLikeLocalSeedRef &&
      (easDataType === 'bytes32' || easDataType === 'string')
    ) {
      attestationEntry._propertyName = basicProperty.propertyName
      attestationEntry._propertyNameForSchema = propertyNameForSchema
      attestationEntry._schemaDef = schemaDef
      attestationEntry._unresolvedValue = value.trim()
      attestationEntry._easDataType = easDataType
    }
    if (rawListIdsForResolve && rawListIdsForResolve.length > 0) {
      attestationEntry._propertyName = basicProperty.propertyName
      attestationEntry._propertyNameForSchema = propertyNameForSchema
      attestationEntry._schemaDef = schemaDef
      attestationEntry._easDataType = 'bytes32[]'
      attestationEntry._rawListIdsForResolve = rawListIdsForResolve
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
  buildOpts?: PublishBuildOpts,
): Promise<MultiPublishPayload> => {
  const forceFullSnapshot = buildOpts?.forceFullSnapshot === true
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
  if (isStorageSeed && ((context as any).seedLocalId || (context as any).seedUid)) {
    const { getPropertyData: getPropertyDataFromDb } = await import('@/db/read/getPropertyData')
    const metaRow = await getPropertyDataFromDb({
      propertyName: relationOrImageProperty.propertyName,
      seedLocalId: (context as any).seedLocalId,
      seedUid: (context as any).seedUid,
    })
    const fromMeta = metaRow?.propertyValue
    if (typeof fromMeta === 'string' && fromMeta.trim() !== '') {
      const idsCtx = resolveSeedIdsFromRefString(normalizeRelationPropertyValue(value) ?? '')
      const idsDb = resolveSeedIdsFromRefString(normalizeRelationPropertyValue(fromMeta) ?? '')
      if (!value) {
        value = fromMeta
      } else if (!idsCtx.seedLocalId && !idsCtx.seedUid && (idsDb.seedLocalId || idsDb.seedUid)) {
        value = fromMeta
      }
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

  if (!value) {
    return multiPublishPayload
  }
  if (relationOrImageProperty.uid && !forceFullSnapshot) {
    return multiPublishPayload
  }

  const normalizedRef = normalizeRelationPropertyValue(value)
  const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(normalizedRef ?? '')

  // Value is not a valid seed reference (local id or 0x uid)
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
  if (relatedItem.seedUid && relatedItem.seedUid !== ZERO_BYTES32) {
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

  if (
    mergeChildPublishPayloadIfDuplicateInBatch(
      multiPublishPayload,
      relatedItem.seedLocalId,
      originalSeedLocalId,
      relationOrImageSchemaUid,
    )
  ) {
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

  const relatedStorageUpload = resolveStorageTransactionUploadSlot(
    relatedItem,
    itemUploadProperties,
  )
  if (relatedStorageUpload) {
    const transactionData = findUploadedTxForSeedLocalId(
      uploadedTransactions,
      relatedItem.seedLocalId,
    )
    if (transactionData) {
      const itemProperty = relatedStorageUpload.itemProperty
      // Publish encoding reads context.propertyValue; do not await ItemProperty.save() here — it
      // uses xstate waitFor(10s) for idle and can time out while the machine is busy or still loading.
      itemProperty.getService().send({
        type: 'updateContext',
        propertyValue: transactionData.txId,
        renderValue: transactionData.txId,
      })
      replaceStorageTransactionInBasicProperties(itemBasicProperties, itemProperty)
    }
  }

  for (const p of itemBasicProperties) {
    if (
      isStorageTransactionPropertyName(p.propertyName) &&
      !p.propertyDef &&
      relatedItem.modelName
    ) {
      const schema = await getPropertySchema(relatedItem.modelName, 'storageTransactionId')
      if (schema) {
        p.getService().send({ type: 'updateContext', propertyRecordSchema: schema })
      }
    }
  }

  dedupeOneStorageTransactionPropertyInList(itemBasicProperties)
  publishPayload = await processBasicProperties(itemBasicProperties, publishPayload, ctx, {
    forceFullSnapshot,
  })

  multiPublishPayload.push(publishPayload)

  return multiPublishPayload
}

async function resolveHtmlPropertySchemaUidByHtmlSeed(
  item: IItem<any>,
  htmlSeedLocalId: string,
  ctx: PublishValidationContext,
): Promise<string | undefined> {
  const want = htmlSeedLocalId.trim()
  for (const p of item.properties) {
    if (p.propertyDef?.dataType !== ModelPropertyDataTypes.Html) continue
    const snap = p.getService().getSnapshot()
    const c = 'context' in snap ? snap.context : null
    const pv = typeof (c as any)?.propertyValue === 'string' ? (c as any).propertyValue.trim() : ''
    if (pv !== want) continue
    let uid = p.schemaUid
    if (!uid) {
      const pd = await getPropertyData(p, ctx)
      uid = pd?.schemaUid
    }
    return uid
  }
  addValidationError(
    ctx,
    `Could not find Html property for embedded image rewrite (html seed ${want}).`,
    'html',
    'html_embed_schema',
  )
  return undefined
}

async function processHtmlEmbeddedCoPublishImagePayloads(
  item: IItem<any>,
  multiPublishPayload: MultiPublishPayload,
  uploadedTransactions: UploadedTransaction[],
  originalSeedLocalId: string,
  ctx: PublishValidationContext,
  buildOpts?: PublishBuildOpts,
): Promise<MultiPublishPayload> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return multiPublishPayload

  const rows = await appDb
    .select()
    .from(htmlEmbeddedImageCoPublish)
    .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, item.seedLocalId))

  if (rows.length === 0) return multiPublishPayload

  const forceFullSnapshot = buildOpts?.forceFullSnapshot === true
  const getItemMod = await import('../../db/read/getItem')
  const { getItem } = getItemMod
  const doneImages = new Set<string>()

  for (const row of rows) {
    if (doneImages.has(row.imageSeedLocalId)) continue
    doneImages.add(row.imageSeedLocalId)

    const htmlSchemaUid = await resolveHtmlPropertySchemaUidByHtmlSeed(item, row.htmlSeedLocalId, ctx)
    if (!htmlSchemaUid) continue

    const relatedItem = await getItem({ seedLocalId: row.imageSeedLocalId })
    if (!relatedItem) {
      addValidationError(
        ctx,
        `Embedded Image item not found for seed ${row.imageSeedLocalId}.`,
        'html',
        'html_embed_image_missing',
      )
      continue
    }
    if (relatedItem.seedUid && relatedItem.seedUid !== ZERO_BYTES32) {
      continue
    }

    const seedSchemaUid = await getEasSchemaUidForModel('Image')
    if (!seedSchemaUid) {
      addValidationError(ctx, `Schema UID not found for model: Image`, 'html')
      continue
    }

    if (
      mergeChildPublishPayloadIfDuplicateInBatch(
        multiPublishPayload,
        relatedItem.seedLocalId,
        originalSeedLocalId,
        htmlSchemaUid,
      )
    ) {
      continue
    }

    const versionUid = getVersionUid(relatedItem)

    let publishPayload: PublishPayload = {
      localId: relatedItem.seedLocalId,
      seedIsRevocable: true,
      versionSchemaUid: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
      seedUid: relatedItem.seedUid || ZERO_BYTES32,
      seedSchemaUid,
      versionUid,
      listOfAttestations: [],
      propertiesToUpdate: [
        {
          publishLocalId: originalSeedLocalId,
          propertySchemaUid: htmlSchemaUid,
        },
      ],
    }

    await ensurePropertyDefs(relatedItem)
    const { itemBasicProperties, itemUploadProperties } =
      await getSegmentedItemProperties(relatedItem)

    const relatedStorageUpload = resolveStorageTransactionUploadSlot(
      relatedItem,
      itemUploadProperties,
    )
    if (relatedStorageUpload) {
      const transactionData = findUploadedTxForSeedLocalId(
        uploadedTransactions,
        relatedItem.seedLocalId,
      )
      if (transactionData) {
        const itemProperty = relatedStorageUpload.itemProperty
        itemProperty.getService().send({
          type: 'updateContext',
          propertyValue: transactionData.txId,
          renderValue: transactionData.txId,
        })
        replaceStorageTransactionInBasicProperties(itemBasicProperties, itemProperty)
      }
    }

    for (const p of itemBasicProperties) {
      if (
        isStorageTransactionPropertyName(p.propertyName) &&
        !p.propertyDef &&
        relatedItem.modelName
      ) {
        const schema = await getPropertySchema(relatedItem.modelName, 'storageTransactionId')
        if (schema) {
          p.getService().send({ type: 'updateContext', propertyRecordSchema: schema })
        }
      }
    }

    dedupeOneStorageTransactionPropertyInList(itemBasicProperties)
    publishPayload = await processBasicProperties(itemBasicProperties, publishPayload, ctx, {
      forceFullSnapshot,
    })

    multiPublishPayload.push(publishPayload)
  }

  return multiPublishPayload
}

const processListProperty = async (
  listProperty: IItemProperty<any>,
  multiPublishPayload: MultiPublishPayload,
  originalSeedLocalId: string,
  ctx: PublishValidationContext,
  buildOpts?: PublishBuildOpts,
): Promise<MultiPublishPayload> => {
  const forceFullSnapshot = buildOpts?.forceFullSnapshot === true
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
  if (!value) {
    return multiPublishPayload
  }
  if (listProperty.uid && !forceFullSnapshot) {
    return multiPublishPayload
  }

  const singularPropertyName = pluralize.singular(listProperty.propertyName)
  const propertyNameForSchema = `${singularPropertyName}${listProperty.propertyDef!.ref}Ids`
  if (typeof value === 'string') {
    value = parseListPropertyValueFromStorage(value)
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

    if (relatedItem.seedUid && relatedItem.seedUid !== ZERO_BYTES32) {
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

    if (
      mergeChildPublishPayloadIfDuplicateInBatch(
        multiPublishPayload,
        relatedItem.seedLocalId,
        originalSeedLocalId,
        listPropertySchemaUid,
      )
    ) {
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

    dedupeOneStorageTransactionPropertyInList(itemBasicProperties)
    publishPayload = await processBasicProperties(itemBasicProperties, publishPayload, ctx, {
      forceFullSnapshot,
    })

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
    _propertyNameForSchema?: string
    _schemaDef?: string
    _unresolvedValue?: string
    _easDataType?: string
    _rawListIdsForResolve?: string[]
  })[]
  propertiesToUpdate: any[]
}

type MultiPublishPayload = PublishPayload[]

/**
 * Same EAS schema + same encoded attestation bytes (data field). Intentionally ignores refUID so
 * duplicate storageTransactionId rows that only differ by ref (e.g. 0x0 vs version uid) collapse.
 */
function attestationPayloadDedupeKey(att: PublishPayload['listOfAttestations'][number]): string {
  const schema = String((att as { schema?: string }).schema ?? '').toLowerCase()
  const dataArr = (att as { data?: unknown[] }).data
  const d0 = Array.isArray(dataArr) ? dataArr[0] : undefined
  const dataHex =
    d0 && typeof d0 === 'object' && d0 !== null && 'data' in d0
      ? String((d0 as { data?: string }).data ?? '').toLowerCase()
      : ''
  return `${schema}:${dataHex}`
}

/**
 * Collapse duplicate rows in listOfAttestations (same schema + encoded payload).
 */
function dedupeListOfAttestationsInEachPayload(payload: MultiPublishPayload): MultiPublishPayload {
  for (const p of payload) {
    const list = p.listOfAttestations ?? []
    if (list.length <= 1) continue
    const seen = new Set<string>()
    const out: PublishPayload['listOfAttestations'] = []
    for (const a of list) {
      const k = attestationPayloadDedupeKey(a)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(a)
    }
    p.listOfAttestations = out
  }
  return payload
}

/**
 * Merge duplicate PublishPayload rows with the same localId (ordering / batch edge cases).
 * Dedupe listOfAttestations so identical storage tx attestations are not emitted twice.
 */
function dedupeMultiPublishPayloadByLocalId(payload: MultiPublishPayload): MultiPublishPayload {
  const map = new Map<string, PublishPayload>()
  const order: string[] = []

  for (const p of payload) {
    const id = p.localId
    const existing = map.get(id)
    if (!existing) {
      map.set(id, p)
      order.push(id)
      continue
    }
    const ptu = [...(existing.propertiesToUpdate ?? [])]
    for (const u of p.propertiesToUpdate ?? []) {
      if (
        !ptu.some(
          (e) =>
            e.publishLocalId === u.publishLocalId &&
            String(e.propertySchemaUid ?? '').toLowerCase() ===
              String(u.propertySchemaUid ?? '').toLowerCase(),
        )
      ) {
        ptu.push(u)
      }
    }
    existing.propertiesToUpdate = ptu
    const seenKeys = new Set((existing.listOfAttestations ?? []).map((a) => attestationPayloadDedupeKey(a)))
    const merged = [...(existing.listOfAttestations ?? [])]
    for (const a of p.listOfAttestations ?? []) {
      const k = attestationPayloadDedupeKey(a)
      if (seenKeys.has(k)) continue
      seenKeys.add(k)
      merged.push(a)
    }
    existing.listOfAttestations = merged
  }

  return order.map((id) => map.get(id)!).filter(Boolean) as MultiPublishPayload
}

/** Map of seed localId -> attestation uid for resolving relation/image property values after dependent seeds are published */
export type ResolvedSeedUids = Record<string, string>

type UploadedTransaction = {
  txId: string
  itemPropertyLocalId?: string
  seedLocalId?: string
  versionLocalId?: string
  itemPropertyName?: string
}

/** Same shape as UploadProperty in getPublishUploads */
type StorageUploadSlot = {
  itemProperty: IItemProperty<any>
  childProperties: IItemProperty<any>[]
}

/**
 * Child File/Image items may keep storageTransactionId only on the item machine's
 * propertyInstances map; allProperties / item.properties can omit it during publish.
 */
function getStorageTransactionPropertyFromItemInstances(
  item: IItem<any>,
): IItemProperty<any> | undefined {
  try {
    const svc = (item as { getService?: () => { getSnapshot: () => unknown } }).getService?.()
    if (!svc) return undefined
    const snap = svc.getSnapshot() as {
      context?: { propertyInstances?: Map<string, IItemProperty<any>> }
    }
    const instances = snap.context?.propertyInstances
    if (!instances || !(instances instanceof Map)) return undefined
    const direct =
      instances.get('storageTransactionId') ?? instances.get('storage_transaction_id')
    if (direct) return direct
    for (const [, p] of instances) {
      if (p && isStorageTransactionPropertyName(p.propertyName)) return p
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Resolve storageTransactionId (+ ItemStorage children) for publish.
 * getSegmentedItemProperties can yield empty itemUploadProperties when the child Item never
 * hydrated storageTransactionId into the upload bucket (e.g. only uri/metadata rows), while
 * getStorageSeedUploads still creates an Arweave upload keyed by child seedLocalId.
 */
function resolveStorageTransactionUploadSlot(
  item: IItem<any>,
  itemUploadProperties: StorageUploadSlot[],
): StorageUploadSlot | undefined {
  const named = itemUploadProperties.find((u) =>
    isStorageTransactionPropertyName(u.itemProperty.propertyName),
  )
  if (named) return named
  if (itemUploadProperties.length === 1) return itemUploadProperties[0]

  const all = (item as { allProperties?: Record<string, IItemProperty<any>> }).allProperties
  const fromInstances = getStorageTransactionPropertyFromItemInstances(item)
  const storagePropEarly =
    all?.['storageTransactionId'] ??
    all?.['storage_transaction_id'] ??
    Object.values(all ?? {}).find(
      (p): p is IItemProperty<any> =>
        !!p && isStorageTransactionPropertyName((p as IItemProperty<any>).propertyName),
    ) ??
    item.properties?.find((p) => isStorageTransactionPropertyName(p.propertyName))
  const storageProp = storagePropEarly ?? fromInstances
  if (!storageProp) return undefined

  const childProps =
    item.properties?.filter(
      (p) =>
        p.propertyDef &&
        (p.propertyDef as { storageType?: string }).storageType === 'ItemStorage',
    ) ?? []
  return { itemProperty: storageProp, childProperties: childProps }
}

function findUploadedTxForSeedLocalId(
  uploadedTransactions: UploadedTransaction[],
  seedLocalId: string,
): UploadedTransaction | undefined {
  const t = seedLocalId.trim()
  return (
    uploadedTransactions.find((u) => u.seedLocalId === t) ??
    uploadedTransactions.find((u) => u.seedLocalId != null && u.seedLocalId.trim() === t)
  )
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
  item: IItem<any>,
  uploadedTransactions: UploadedTransaction[],
  options?: GetPublishPayloadOptions,
): Promise<MultiPublishPayload> => {
  const validationCtx: PublishValidationContext = { errors: [] }
  const publishMode: PublishMode = options?.publishMode ?? 'patch'
  const forceFullSnapshot = publishMode === 'new_version'

  if (publishMode === 'new_version' && (!item.seedUid || item.seedUid === ZERO_BYTES32)) {
    addValidationError(
      validationCtx,
      'Publishing as a new version requires the item to already have a published Seed attestation (seed UID).',
      'seedUid',
      'publish_new_version_requires_seed',
    )
  }

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
  if (forceFullSnapshot && item.seedUid && item.seedUid !== ZERO_BYTES32) {
    versionUid = ZERO_BYTES32
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

  const rootStorageUpload = resolveStorageTransactionUploadSlot(item, itemUploadProperties)
  if (rootStorageUpload) {
    const transactionData = findUploadedTxForSeedLocalId(uploadedTransactions, item.seedLocalId)
    if (transactionData) {
      const itemProperty = rootStorageUpload.itemProperty
      itemProperty.getService().send({
        type: 'updateContext',
        propertyValue: transactionData.txId,
        renderValue: transactionData.txId,
      })
      replaceStorageTransactionInBasicProperties(itemBasicProperties, itemProperty)
    }
  }

  for (const relationProperty of relationAndImageProperties) {
    multiPublishPayload = await processRelationOrImageProperty(
      relationProperty,
      multiPublishPayload,
      uploadedTransactions,
      item.seedLocalId,
      validationCtx,
      { forceFullSnapshot },
    )
    itemBasicProperties.push(relationProperty)
  }

  multiPublishPayload = await processHtmlEmbeddedCoPublishImagePayloads(
    item,
    multiPublishPayload,
    uploadedTransactions,
    item.seedLocalId,
    validationCtx,
    { forceFullSnapshot },
  )

  for (const listProperty of itemListProperties) {
    multiPublishPayload = await processListProperty(
      listProperty,
      multiPublishPayload,
      item.seedLocalId,
      validationCtx,
      { forceFullSnapshot },
    )
    itemBasicProperties.push(listProperty)
  }

  for (const p of itemBasicProperties) {
    if (isStorageTransactionPropertyName(p.propertyName) && !p.propertyDef && item.modelName) {
      const schema = await getPropertySchema(item.modelName, 'storageTransactionId')
      if (schema) {
        p.getService().send({ type: 'updateContext', propertyRecordSchema: schema })
      }
    }
  }

  dedupeOneStorageTransactionPropertyInList(itemBasicProperties)
  itemPublishData = await processBasicProperties(
    itemBasicProperties,
    itemPublishData,
    validationCtx,
    { forceFullSnapshot },
  )

  multiPublishPayload.push(itemPublishData)

  // Ensure requests are ordered so that when A has propertiesToUpdate pointing to B (publishLocalId),
  // A (the updater) is published before B (the updatee). The contract injects A's seedUid into B's
  // attestation before B is sent to EAS.
  multiPublishPayload = dedupeMultiPublishPayloadByLocalId(multiPublishPayload)
  multiPublishPayload = orderPayloadByDependencies(multiPublishPayload)

  // Ensure attestations referenced in propertiesToUpdate have at least one data element.
  // The contract writes the seed UID into data[0].data; empty data causes Panic 50.
  multiPublishPayload = ensurePropertiesToUpdateAttestationsHaveData(multiPublishPayload)
  multiPublishPayload = dedupeListOfAttestationsInEachPayload(multiPublishPayload)

  if (publishMode === 'new_version') {
    const rootPayload = multiPublishPayload.find((p) => p.localId === item.seedLocalId)
    const listLen = rootPayload?.listOfAttestations?.length ?? 0
    if (!rootPayload || listLen === 0) {
      addValidationError(
        validationCtx,
        'Publishing as a new version requires at least one property attestation for the item. ' +
          'Ensure required fields have values and that publishable properties are present.',
        'listOfAttestations',
        'publish_new_version_empty_snapshot',
      )
    }
  }

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
  item: IItem<any>,
  uploadedTransactions: UploadedTransaction[] = [],
  options?: GetPublishPayloadOptions,
): Promise<ValidateItemForPublishResult> => {
  try {
    await getPublishPayload(item, uploadedTransactions, options)
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
 * LocalIds in this batch referenced by attestations (bytes32 / bytes32[]) that must publish before this request.
 */
function collectAttestationLocalRefIds(
  req: PublishPayload,
  allLocalIds: Set<string>,
): string[] {
  const refs: string[] = []
  for (const a of req.listOfAttestations ?? []) {
    const att = a as {
      _unresolvedValue?: string
      _rawListIdsForResolve?: string[]
    }
    if (att._unresolvedValue && allLocalIds.has(att._unresolvedValue)) {
      refs.push(att._unresolvedValue)
    }
    if (Array.isArray(att._rawListIdsForResolve)) {
      for (const id of att._rawListIdsForResolve) {
        const t = id != null ? String(id).trim() : ''
        if (t && allLocalIds.has(t)) refs.push(t)
      }
    }
  }
  return refs
}

/**
 * Topological sort (Kahn): edge `from → to` means `from` must publish before `to`.
 * - propertiesToUpdate: updater before updatee (contract injection).
 * - _unresolvedValue / _rawListIdsForResolve: referenced seed before request that encodes the ref.
 * The previous DFS visit could order [Post, Image] when Post appeared first in the input array,
 * so resolvedUids was empty when Post was published and attestations kept local ids.
 */
function orderPayloadByDependencies(payload: MultiPublishPayload): MultiPublishPayload {
  if (payload.length <= 1) return payload

  const byLocalId = new Map<string, PublishPayload>()
  const allIds = new Set<string>()
  const indexOrder = new Map<string, number>()
  for (let i = 0; i < payload.length; i++) {
    const p = payload[i]
    byLocalId.set(p.localId, p)
    allIds.add(p.localId)
    indexOrder.set(p.localId, i)
  }

  const indegree = new Map<string, number>()
  for (const id of allIds) indegree.set(id, 0)

  const adj = new Map<string, Set<string>>()

  const addEdge = (from: string, to: string) => {
    if (from === to || !allIds.has(from) || !allIds.has(to)) return
    if (!adj.has(from)) adj.set(from, new Set())
    const set = adj.get(from)!
    if (set.has(to)) return
    set.add(to)
    indegree.set(to, (indegree.get(to) ?? 0) + 1)
  }

  for (const p of payload) {
    for (const u of p.propertiesToUpdate ?? []) {
      const targetId = (u as { publishLocalId?: string }).publishLocalId
      if (targetId && targetId !== p.localId) addEdge(p.localId, targetId)
    }
    for (const refId of collectAttestationLocalRefIds(p, allIds)) {
      addEdge(refId, p.localId)
    }
  }

  const zero: string[] = []
  for (const id of allIds) {
    if ((indegree.get(id) ?? 0) === 0) zero.push(id)
  }
  zero.sort((a, b) => (indexOrder.get(a) ?? 0) - (indexOrder.get(b) ?? 0))

  const result: PublishPayload[] = []
  const queue = zero

  while (queue.length > 0) {
    const id = queue.shift()!
    const p = byLocalId.get(id)
    if (p) result.push(p)
    for (const to of adj.get(id) ?? []) {
      const next = (indegree.get(to) ?? 0) - 1
      indegree.set(to, next)
      if (next === 0) {
        queue.push(to)
        queue.sort((a, b) => (indexOrder.get(a) ?? 0) - (indexOrder.get(b) ?? 0))
      }
    }
  }

  if (result.length !== payload.length) {
    const seen = new Set(result.map((r) => r.localId))
    for (const p of payload) {
      if (!seen.has(p.localId)) result.push(p)
    }
  }

  return result
}

/** Normalize attestation UID to 32-byte hex for SchemaEncoder bytes32 fields. */
function padUidForBytes32Schema(uid: string): string {
  const t = uid.trim()
  if (!t.startsWith('0x')) return uid
  const hex = t.slice(2).replace(/[^0-9a-fA-F]/g, '')
  if (hex.length === 0) return uid
  return ('0x' + hex.padStart(64, '0').slice(-64)).toLowerCase()
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
        _propertyNameForSchema?: string
        _rawListIdsForResolve?: string[]
        data?: AttestationRequestData[] | AttestationRequestData
      }

      const rawList = entry._rawListIdsForResolve
      if (
        rawList &&
        rawList.length > 0 &&
        entry._schemaDef &&
        (entry._propertyNameForSchema || entry._propertyName)
      ) {
        const fieldName =
          entry._propertyNameForSchema ?? toSnakeCase(entry._propertyName as string)
        const resolvedValues: string[] = []
        let allSlotsResolved = true
        for (const id of rawList) {
          const trimmed = id.trim()
          if (trimmed.length === 66 && trimmed.startsWith('0x')) {
            resolvedValues.push(padUidForBytes32Schema(trimmed))
            continue
          }
          const r = resolvedUids[trimmed]
          if (r) {
            resolvedValues.push(padUidForBytes32Schema(r))
            continue
          }
          allSlotsResolved = false
          break
        }
        // Do not encode or clear hints until every slot has a real uid — otherwise sequential
        // publish burns encodeBytes32String(localId) into data and drops _rawListIdsForResolve.
        if (!allSlotsResolved) {
          updatedAttestations.push({
            ...entry,
            data: Array.isArray(entry.data) ? entry.data : [entry.data as AttestationRequestData],
          })
          continue
        }
        const dataEncoder = new SchemaEncoder(entry._schemaDef)
        const encodedData = dataEncoder.encodeData([
          {
            name: fieldName,
            type: 'bytes32[]',
            value: resolvedValues,
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
          _rawListIdsForResolve: undefined,
          _easDataType: undefined,
        })
        continue
      }

      const resolvedUid = entry._unresolvedValue && resolvedUids[entry._unresolvedValue]
      const easType = (entry._easDataType as 'bytes32' | 'string') || 'bytes32'
      if (resolvedUid && entry._schemaDef && (entry._propertyNameForSchema || entry._propertyName)) {
        const fieldName =
          entry._propertyNameForSchema ?? toSnakeCase(entry._propertyName as string)
        const valueForEncode =
          easType === 'bytes32' ? padUidForBytes32Schema(resolvedUid) : resolvedUid
        const dataEncoder = new SchemaEncoder(entry._schemaDef)
        const encodedData = dataEncoder.encodeData([
          {
            name: fieldName,
            type: easType,
            value: valueForEncode,
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
