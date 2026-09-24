/**
 * Counts seeds, property attestations, and Arweave upload bytes for a publish
 * without building transactions or requiring a valid payload.
 */
import { BaseFileManager } from '@/helpers'
import { INTERNAL_PROPERTY_NAMES, ZERO_BYTES32 } from '@/helpers/constants'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import {
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@/helpers/relationSeedRef'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import { IItem, IItemProperty } from '@/interfaces'
import { BaseDb } from '@/db/Db/BaseDb'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { eq } from 'drizzle-orm'
import type { UploadProperty } from '@/db/read/getPublishUploads'
import type { PublishMode } from '@/db/read/getPublishPayload'

export type { PublishMode }

export type SummarizePublishWorkOptions = {
  publishMode?: PublishMode
}

export type PublishWorkSummary = {
  publishMode: PublishMode
  seedCount: number
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
  uploadCount: number
  uploadBytes: number
}

const DATA_URI = /^data:[^;]+;base64,([\s\S]*)$/i

const matchesDataType = (
  actual: string | undefined,
  expected: ModelPropertyDataTypes | string,
): boolean => normalizeDataType(actual) === expected

function isZeroUid(uid: string | undefined | null): boolean {
  return !uid || uid === ZERO_BYTES32
}

function isStorageTransactionPropertyName(name: string | undefined): boolean {
  return name === 'storageTransactionId' || name === 'storage_transaction_id'
}

/** Decoded byte length of a data-URI, or null if the string is not a base64 data URI. */
export function estimateDataUriByteLength(dataUri: string): number | null {
  const m = DATA_URI.exec((dataUri ?? '').trim())
  if (!m) return null
  const b64 = m[1]!.replace(/\s/g, '')
  if (!b64) return 0
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}

function propertyContext(prop: IItemProperty<any>): Record<string, unknown> | null {
  const snapshot = prop.getService().getSnapshot()
  return snapshot && 'context' in snapshot
    ? ((snapshot as { context?: Record<string, unknown> }).context ?? null)
    : null
}

function getPublishValue(prop: IItemProperty<any>, context: Record<string, unknown>): unknown {
  const propertyDef =
    prop.propertyDef ?? (context.propertyRecordSchema as { dataType?: string; refValueType?: string } | undefined)
  const isFileImageHtml =
    matchesDataType(propertyDef?.dataType, ModelPropertyDataTypes.File) ||
    matchesDataType(propertyDef?.dataType, ModelPropertyDataTypes.Image) ||
    matchesDataType(propertyDef?.dataType, ModelPropertyDataTypes.Html)
  const isJsonStorage =
    matchesDataType(propertyDef?.dataType, ModelPropertyDataTypes.Json) ||
    matchesDataType(propertyDef?.refValueType, ModelPropertyDataTypes.Json)
  const isRelation = matchesDataType(propertyDef?.dataType, ModelPropertyDataTypes.Relation)
  const isStorageTransactionIdProp = isStorageTransactionPropertyName(prop.propertyName)
  const preferPropertyValue =
    isFileImageHtml || isRelation || isJsonStorage || isStorageTransactionIdProp
  let value = preferPropertyValue
    ? context.propertyValue
    : (prop.value ?? context.propertyValue)

  if (isRelation || isFileImageHtml || isJsonStorage) {
    const pv = context.propertyValue
    if (typeof value === 'object' || value == null) {
      if (typeof pv === 'string' && pv.trim()) value = pv.trim()
      else if (pv && typeof pv === 'object' && typeof (pv as { seedLocalId?: string }).seedLocalId === 'string') {
        value = (pv as { seedLocalId: string }).seedLocalId
      }
    }
  }
  return value
}

export function shouldAttestProperty(
  prop: IItemProperty<any>,
  forceFullSnapshot: boolean,
): boolean {
  if (INTERNAL_PROPERTY_NAMES.includes(prop.propertyName)) return false
  const context = propertyContext(prop)
  if (!context) return false
  const value = getPublishValue(prop, context)
  if (value == null || value === '') return false
  if (prop.uid && !forceFullSnapshot) {
    const allowStorageTx =
      isStorageTransactionPropertyName(prop.propertyName) &&
      typeof value === 'string' &&
      value.trim() !== ''
    if (!allowStorageTx) return false
  }
  return true
}

function getStorageDirForDataType(dataType: string): string {
  switch (dataType) {
    case 'Image':
      return BaseFileManager.getFilesPath('images')
    case 'File':
      return BaseFileManager.getFilesPath('files')
    case 'Html':
      return BaseFileManager.getFilesPath('html')
    case 'Json':
      return BaseFileManager.getFilesPath('json')
    default:
      return BaseFileManager.getFilesPath('images')
  }
}

async function addUpload(
  acc: PublishWorkSummary,
  seen: Set<string>,
  key: string,
  bytes: number,
): Promise<void> {
  if (bytes <= 0 || seen.has(key)) return
  seen.add(key)
  acc.uploadCount += 1
  acc.uploadBytes += bytes
}

async function addUploadFromPath(
  acc: PublishWorkSummary,
  seen: Set<string>,
  filePath: string,
  key: string,
): Promise<void> {
  if (!filePath || filePath.endsWith('undefined')) return
  const size = await BaseFileManager.getFileSize(filePath)
  if (size == null || size <= 0) return
  await addUpload(acc, seen, key, size)
}

async function collectUploadBytes(
  item: IItem<any>,
  itemUploadProperties: UploadProperty[],
  itemImageProperties: IItemProperty<any>[],
  relatedItemProperty: IItemProperty<any> | undefined,
  acc: PublishWorkSummary,
  seen: Set<string>,
): Promise<void> {
  for (const uploadProperty of itemUploadProperties) {
    let childBytes = 0
    let childCount = 0
    for (const childProperty of uploadProperty.childProperties) {
      const filePath = childProperty.localStoragePath
      if (!filePath || filePath.endsWith('undefined')) continue
      const size = await BaseFileManager.getFileSize(filePath)
      if (size == null || size <= 0) continue
      childBytes += size
      childCount += 1
    }
    if (childCount > 0) {
      await addUpload(acc, seen, `upload:${item.seedLocalId}:${uploadProperty.itemProperty.localId}`, childBytes)
      continue
    }
    const relatedPath = relatedItemProperty?.localStoragePath
    if (relatedPath) {
      await addUploadFromPath(
        acc,
        seen,
        relatedPath,
        `path:${relatedPath}`,
      )
    }
  }

  for (const itemProperty of itemImageProperties) {
    const context = propertyContext(itemProperty)
    if (!context) continue
    const refResolvedValue =
      (typeof context.refResolvedValue === 'string' && context.refResolvedValue) ||
      itemProperty.refResolvedValue
    if (typeof refResolvedValue !== 'string' || !refResolvedValue) continue
    const propertyValue = context.propertyValue
    const { seedLocalId } = resolveSeedIdsFromRefString(
      normalizeRelationPropertyValue(propertyValue) ?? '',
    )
    const dataType =
      itemProperty.propertyDef?.refValueType ??
      itemProperty.propertyDef?.dataType ??
      'Image'
    const fromGetter = itemProperty.localStoragePath
    const filePath =
      typeof fromGetter === 'string' && fromGetter
        ? fromGetter
        : `${getStorageDirForDataType(String(dataType))}/${refResolvedValue}`
    await addUploadFromPath(
      acc,
      seen,
      filePath,
      seedLocalId ? `seed:${seedLocalId}` : `path:${filePath}`,
    )
  }
}

async function loadRelatedItem(
  value: unknown,
): Promise<IItem<any> | undefined> {
  const normalized = normalizeRelationPropertyValue(value)
  if (!normalized) return undefined
  const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(normalized)
  if (!seedLocalId && !seedUid) return undefined
  const { getItem } = await import('./getItem')
  try {
    return await getItem({ seedLocalId, seedUid })
  } catch {
    return undefined
  }
}

async function relatedIfUnpublished(
  prop: IItemProperty<any>,
): Promise<IItem<any> | undefined> {
  const context = propertyContext(prop)
  if (!context) return undefined
  const related = await loadRelatedItem(context.propertyValue)
  if (!related || !isZeroUid(related.seedUid)) return undefined
  return related
}

async function unpublishedListItems(listProperty: IItemProperty<any>): Promise<IItem<any>[]> {
  const context = propertyContext(listProperty)
  if (!context) return []
  let value = context.propertyValue
  if (!value) return []
  if (typeof value === 'string') {
    value = parseListPropertyValueFromStorage(value)
  }
  const arr = Array.isArray(value) ? value : []
  const out: IItem<any>[] = []
  for (const seedId of arr) {
    const related = await loadRelatedItem(seedId)
    if (related && isZeroUid(related.seedUid)) out.push(related)
  }
  return out
}

async function appendCoPublishImages(
  item: IItem<any>,
  acc: PublishWorkSummary,
  seen: Set<string>,
  visited: Set<string>,
  forceFullSnapshot: boolean,
  publishMode: PublishMode,
): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return
  const rows = await appDb
    .select()
    .from(htmlEmbeddedImageCoPublish)
    .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, item.seedLocalId))

  for (const row of rows) {
    const { Item } = await import('../../Item/Item')
    const imageItem = await Item.find({
      seedLocalId: row.imageSeedLocalId,
      modelName: 'Image',
    })
    if (!imageItem) continue

    const st =
      imageItem.internalProperties['storageTransactionId'] ??
      imageItem.allProperties['storageTransactionId']
    const stCtx = st ? propertyContext(st) : null
    const stValue =
      typeof stCtx?.propertyValue === 'string' ? (stCtx.propertyValue as string) : ''
    const dataUriBytes = estimateDataUriByteLength(stValue)
    if (dataUriBytes != null && dataUriBytes > 0) {
      await addUpload(acc, seen, `seed:${imageItem.seedLocalId}`, dataUriBytes)
    }

    await summarizeItem(imageItem, publishMode, forceFullSnapshot, acc, seen, visited)
  }
}

async function summarizeItem(
  item: IItem<any>,
  publishMode: PublishMode,
  forceFullSnapshot: boolean,
  acc: PublishWorkSummary,
  seenUploads: Set<string>,
  visited: Set<string>,
): Promise<void> {
  const seedLocalId = item.seedLocalId
  if (!seedLocalId || visited.has(seedLocalId)) return
  visited.add(seedLocalId)

  acc.seedCount += 1
  if (isZeroUid(item.seedUid)) acc.newSeedCount += 1
  if (isZeroUid(item.seedUid) || forceFullSnapshot) acc.newVersionCount += 1

  const {
    itemBasicProperties,
    itemRelationProperties,
    itemListProperties,
    itemUploadProperties,
    itemImageProperties,
  } = await getSegmentedItemProperties(item)

  await collectUploadBytes(
    item,
    itemUploadProperties,
    itemImageProperties,
    undefined,
    acc,
    seenUploads,
  )

  for (const rel of itemRelationProperties) {
    const related = await relatedIfUnpublished(rel)
    if (related) {
      await summarizeItem(related, publishMode, forceFullSnapshot, acc, seenUploads, visited)
    }
  }

  for (const listProperty of itemListProperties) {
    for (const related of await unpublishedListItems(listProperty)) {
      await summarizeItem(related, publishMode, forceFullSnapshot, acc, seenUploads, visited)
    }
  }

  await appendCoPublishImages(item, acc, seenUploads, visited, forceFullSnapshot, publishMode)

  const attestable: IItemProperty<any>[] = [
    ...itemBasicProperties,
    ...itemRelationProperties,
    ...itemListProperties,
    ...itemImageProperties,
    ...itemUploadProperties.map((u) => u.itemProperty),
  ]
  const seenProps = new Set<string>()
  for (const prop of attestable) {
    const key = prop.localId || `${prop.propertyName}:${prop.seedLocalId}`
    if (seenProps.has(key)) continue
    seenProps.add(key)
    if (shouldAttestProperty(prop, forceFullSnapshot)) acc.attestationCount += 1
  }
}

/**
 * Local measurement of what a publish would do: seed/version/attestation counts
 * and Arweave upload byte totals. Does not hit the network or create transactions.
 */
export const summarizePublishWork = async (
  item: IItem<any>,
  options?: SummarizePublishWorkOptions,
): Promise<PublishWorkSummary> => {
  const publishMode: PublishMode = options?.publishMode ?? 'patch'
  const forceFullSnapshot = publishMode === 'new_version'
  const acc: PublishWorkSummary = {
    publishMode,
    seedCount: 0,
    newSeedCount: 0,
    newVersionCount: 0,
    attestationCount: 0,
    uploadCount: 0,
    uploadBytes: 0,
  }
  await summarizeItem(item, publishMode, forceFullSnapshot, acc, new Set(), new Set())
  return acc
}
