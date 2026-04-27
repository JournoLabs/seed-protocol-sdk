import { BaseFileManager } from '@/helpers'
import {
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@/helpers/relationSeedRef'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import debug from 'debug'
import { IItem, IItemProperty } from '@/interfaces'
import { getContentHash } from '@/helpers/crypto'
import { Item } from '@/Item/Item'
import type { ArweaveTransaction, TransactionTag } from '@/types/arweave'
import { PublishUpload } from '@/types/publish'
import { BaseDb } from '@/db/Db/BaseDb'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { eq } from 'drizzle-orm'
import { ModelPropertyDataTypes } from '@/helpers/property'

const logger = debug('seedSdk:item:getPublishUploads')

/** Optional tags merged into each Arweave tx after Content-SHA-256 / Content-Type. */
export type GetPublishUploadsOptions = {
  arweaveUploadTags?: TransactionTag[]
  /**
   * Html storage seed local ids to skip (phase 1 of two-phase embedded-image publish).
   */
  deferHtmlStorageSeedLocalIds?: string[]
  /**
   * When set, only Html storage seeds in this list are included (phase 2). Non-Html storage uploads are omitted.
   */
  onlyHtmlStorageSeedLocalIds?: string[]
  /** When true, do not recurse into relation properties (phase 2 must not re-upload related items). */
  skipRelationRecursion?: boolean
}

const EXTENSION_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  txt: 'text/plain',
}

const getMimeTypeFromPath = (filePathOrName: string): string | undefined => {
  const ext = filePathOrName.split('.').pop()?.toLowerCase()
  return ext ? EXTENSION_TO_MIME[ext] : undefined
}

const toUint8Array = async (data: Buffer | Blob): Promise<Uint8Array> => {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }
  return new Uint8Array(data as Buffer)
}

export const prepareArweaveTransaction = async (
  data: string | Uint8Array,
  contentHash: string | undefined,
  contentType?: string,
  additionalTags?: TransactionTag[],
): Promise<ArweaveTransaction> => {
  const tags: TransactionTag[] = []
  if (contentHash) {
    tags.push({ name: 'Content-SHA-256', value: contentHash })
    logger('contentHash', contentHash)
    logger('adding content hash tag')
  }
  if (contentType) {
    tags.push({ name: 'Content-Type', value: contentType })
  }
  if (additionalTags?.length) {
    tags.push(...additionalTags)
  }

  const tx = await BaseArweaveClient.createTransaction(data, {
    tags: tags.length ? tags : undefined,
  })

  return tx
}


const getStorageDirForDataType = (dataType: string): string => {
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

const DATA_URI_IMAGE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/i

function decodeDataUriImage(dataUri: string): { mimeType: string; bytes: Uint8Array } | null {
  const m = DATA_URI_IMAGE.exec((dataUri ?? '').trim())
  if (!m) return null
  try {
    const mimeType = m[1]!.toLowerCase().trim()
    const base64 = m[2]!.replace(/\s/g, '')
    const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return { mimeType, bytes: binary }
  } catch {
    return null
  }
}

const getStorageSeedUploads = async (
  itemStorageSeedProperties: IItemProperty<any>[],
  options?: GetPublishUploadsOptions,
) => {
  const uploads: PublishUpload[] = []
  const extra = options?.arweaveUploadTags

  for (const itemProperty of itemStorageSeedProperties) {
    const snapshot = itemProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) {
      continue
    }
    const propertyValue = (context as any).propertyValue
    const refResolvedValue = (context as any).refResolvedValue
    if (!refResolvedValue) {
      continue
    }

    // propertyValue is the storage seed's seedLocalId; use it for the upload so processRelationOrImageProperty can match
    const { seedLocalId } = resolveSeedIdsFromRefString(
      normalizeRelationPropertyValue(propertyValue) ?? '',
    )
    if (!seedLocalId) {
      continue
    }

    const dataType =
      itemProperty.propertyDef?.refValueType ??
      itemProperty.propertyDef?.dataType ??
      'Image'

    if (dataType === ModelPropertyDataTypes.Html) {
      if (options?.deferHtmlStorageSeedLocalIds?.includes(seedLocalId)) {
        continue
      }
      if (
        options?.onlyHtmlStorageSeedLocalIds?.length &&
        !options.onlyHtmlStorageSeedLocalIds.includes(seedLocalId)
      ) {
        continue
      }
    } else if (options?.onlyHtmlStorageSeedLocalIds?.length) {
      continue
    }

    const baseDir = getStorageDirForDataType(dataType)
    const filePath = `${baseDir}/${refResolvedValue}`

    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) {
      continue
    }

    const fileBuffer = await BaseFileManager.readFileAsBuffer(filePath)
    const fileContents = await toUint8Array(fileBuffer)

    const contentHash = await getContentHash(fileContents)
    const contentType = getMimeTypeFromPath(refResolvedValue)

    const transaction = await prepareArweaveTransaction(
      fileContents,
      contentHash,
      contentType,
      extra,
    )

    uploads.push({
      itemPropertyName: itemProperty.propertyName,
      itemPropertyLocalId: itemProperty.localId,
      seedLocalId,
      versionLocalId: itemProperty.versionLocalId!,
      transactionToSign: transaction,
    })
  }

  return uploads
}

async function appendCoPublishedImageUploads(
  item: IItem<any>,
  uploads: PublishUpload[],
  options?: GetPublishUploadsOptions,
): Promise<PublishUpload[]> {
  const appDb = BaseDb.getAppDb()
  if (!appDb || options?.onlyHtmlStorageSeedLocalIds?.length) return uploads

  const rows = await appDb
    .select()
    .from(htmlEmbeddedImageCoPublish)
    .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, item.seedLocalId))

  const seen = new Set(uploads.map((u) => u.seedLocalId))

  for (const row of rows) {
    if (seen.has(row.imageSeedLocalId)) continue
    const imageItem = await Item.find({ seedLocalId: row.imageSeedLocalId, modelName: 'Image' })
    if (!imageItem) continue
    const st =
      imageItem.internalProperties['storageTransactionId'] ??
      imageItem.allProperties['storageTransactionId']
    const stSnap = st?.getService().getSnapshot()
    const stCtx = stSnap && 'context' in stSnap ? stSnap.context : undefined
    const stValue = typeof (stCtx as { propertyValue?: unknown } | undefined)?.propertyValue === 'string'
      ? ((stCtx as { propertyValue?: string }).propertyValue ?? '')
      : ''
    const decoded = decodeDataUriImage(stValue)

    const more: PublishUpload[] = []
    if (decoded && st && st.localId && st.versionLocalId) {
      const contentHash = await getContentHash(decoded.bytes)
      const transaction = await prepareArweaveTransaction(
        decoded.bytes,
        contentHash,
        decoded.mimeType,
        options?.arweaveUploadTags,
      )
      more.push({
        itemPropertyName: st.propertyName,
        itemPropertyLocalId: st.localId,
        seedLocalId: imageItem.seedLocalId,
        versionLocalId: st.versionLocalId,
        transactionToSign: transaction,
      })
    }
    for (const u of more) {
      if (!seen.has(u.seedLocalId)) {
        uploads.push(u)
        seen.add(u.seedLocalId)
      }
    }
  }
  return uploads
}

export type UploadProperty = {
  itemProperty: IItemProperty<any>
  childProperties: IItemProperty<any>[]
}
type ChildUploadData = {
  propertyName: string
  localStoragePath: string
}

/**
 * True if publish would include at least one Arweave upload (local file / storage seed present).
 * Does not create Arweave transactions or hit the network — use for routing (e.g. skip EAS-only)
 * when {@link getPublishUploads} would fail early (e.g. gateway unreachable during tx creation).
 */
async function storageSeedHasUploadCandidates(
  itemStorageSeedProperties: IItemProperty<any>[],
): Promise<boolean> {
  for (const itemProperty of itemStorageSeedProperties) {
    const snapshot = itemProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) {
      continue
    }
    const propertyValue = (context as any).propertyValue
    const refResolvedValue = (context as any).refResolvedValue
    if (!refResolvedValue) {
      continue
    }

    const { seedLocalId } = resolveSeedIdsFromRefString(
      normalizeRelationPropertyValue(propertyValue) ?? '',
    )
    if (!seedLocalId) {
      continue
    }

    const dataType =
      itemProperty.propertyDef?.refValueType ??
      itemProperty.propertyDef?.dataType ??
      'Image'
    const baseDir = getStorageDirForDataType(dataType)
    const filePath = `${baseDir}/${refResolvedValue}`

    if (await BaseFileManager.pathExists(filePath)) {
      return true
    }
  }

  return false
}

async function uploadPropertyWouldUpload(
  uploadProperty: UploadProperty,
  relatedItemProperty?: IItemProperty<any>,
): Promise<boolean> {
  const childUploads: ChildUploadData[] = []

  for (const childProperty of uploadProperty.childProperties) {
    const filePath = childProperty.localStoragePath

    if (!filePath || filePath.endsWith('undefined')) {
      continue
    }

    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) {
      continue
    }

    childUploads.push({
      propertyName: childProperty.propertyName,
      localStoragePath: filePath,
    })
  }

  if (childUploads.length > 0) {
    return true
  }

  if (relatedItemProperty && relatedItemProperty.localStoragePath) {
    const filePath = relatedItemProperty.localStoragePath

    if (!filePath || filePath.endsWith('undefined')) {
      return false
    }

    return await BaseFileManager.pathExists(filePath)
  }

  return false
}

export async function itemHasPublishUploadCandidates(
  item: IItem<any>,
  relatedItemProperty?: IItemProperty<any>,
): Promise<boolean> {
  const { itemUploadProperties, itemRelationProperties, itemImageProperties } =
    await getSegmentedItemProperties(item)

  for (const uploadProperty of itemUploadProperties) {
    if (await uploadPropertyWouldUpload(uploadProperty, relatedItemProperty)) {
      return true
    }
  }

  if (await storageSeedHasUploadCandidates(itemImageProperties)) {
    return true
  }

  for (const relationProperty of itemRelationProperties) {
    const snapshot = relationProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) {
      continue
    }
    const propertyValue = (context as any).propertyValue

    if (!propertyValue || relationProperty.uid) {
      continue
    }

    const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(
      normalizeRelationPropertyValue(propertyValue) ?? '',
    )
    if (!seedLocalId && !seedUid) {
      throw new Error(
        `Invalid relation value for ${relationProperty.propertyName}: expected local seed id or 0x uid`,
      )
    }

    const relatedItem = await Item.find({
      seedLocalId,
      seedUid,
    })

    if (!relatedItem) {
      throw new Error(
        `No relatedItem found for ${relationProperty.propertyName}`,
      )
    }

    if (await itemHasPublishUploadCandidates(relatedItem, relationProperty)) {
      return true
    }
  }

  return false
}

const processUploadProperty = async (
  uploadProperty: UploadProperty,
  uploads: PublishUpload[],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadsOptions,
): Promise<PublishUpload[]> => {
  const extra = options?.arweaveUploadTags
  const itemProperty = uploadProperty.itemProperty

  const childUploads: ChildUploadData[] = []

  for (const childProperty of uploadProperty.childProperties) {
    const filePath = childProperty.localStoragePath

    if (!filePath || filePath.endsWith('undefined')) {
      continue
    }

    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) {
      continue
    }

    childUploads.push({
      propertyName: childProperty.propertyName,
      localStoragePath: filePath,
    })
  }

  let fileContents
  let transaction: ArweaveTransaction

  if (!childUploads || childUploads.length === 0) {
    if (relatedItemProperty && relatedItemProperty.localStoragePath) {
      const filePath = relatedItemProperty.localStoragePath

      if (!filePath || filePath.endsWith('undefined')) {
        return uploads
      }

      const exists = await BaseFileManager.pathExists(filePath)
      if (!exists) {
        return uploads
      }

      try {
        const fileBuffer = await BaseFileManager.readFileAsBuffer(filePath)
        fileContents = await toUint8Array(fileBuffer)
      } catch (e) {
        const fs = await BaseFileManager.getFs()
        fileContents = await toUint8Array(fs.readFileSync(filePath))
      }
    }
    if (!fileContents) {
      return uploads
    }
  }

  if (childUploads.length > 0) {
    const separator = '===FILE_SEPARATOR==='
    // let compositeFileContents = `${itemProperty.propertyName}${separator}${mainFileContents}`
    let compositeFileContents = ''

    for (const childUpload of childUploads) {
      let childUploadContents

      const fs = await BaseFileManager.getFs()

      try {
        childUploadContents = await fs.promises.readFile(
          childUpload.localStoragePath,
        )
      } catch (e) {
        childUploadContents = fs.readFileSync(childUpload.localStoragePath)
      }

      compositeFileContents += `${separator}${childUpload.propertyName}${separator}${childUploadContents}`
    }

    if (typeof document !== 'undefined') {
      fileContents = new TextEncoder().encode(compositeFileContents)
    } else {
      fileContents = Buffer.from(compositeFileContents)
    }
  }

  if (!fileContents) {
    throw new Error(`No file contents found for ${itemProperty.propertyName}`)
  }

  const uint8Array = new Uint8Array(fileContents)

  const contentHash = await getContentHash(uint8Array)

  let contentType: string | undefined
  if (childUploads.length === 0 && relatedItemProperty?.localStoragePath) {
    contentType = getMimeTypeFromPath(relatedItemProperty.localStoragePath)
  } else if (childUploads.length > 0) {
    contentType = 'application/octet-stream'
  }

  transaction = await prepareArweaveTransaction(
    uint8Array,
    contentHash,
    contentType,
    extra,
  )

  let itemPropertyLocalId = relatedItemProperty
    ? relatedItemProperty.localId
    : itemProperty.localId
  let itemPropertyName = relatedItemProperty
    ? relatedItemProperty.propertyName
    : itemProperty.propertyName

  uploads.push({
    itemPropertyName,
    itemPropertyLocalId,
    seedLocalId: itemProperty.seedLocalId!,
    versionLocalId: itemProperty.versionLocalId!,
    transactionToSign: transaction,
  })

  return uploads
}

export const getPublishUploads = async (
  item: IItem<any>,
  uploads: PublishUpload[] = [],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadsOptions,
) => {
  const { itemUploadProperties, itemRelationProperties, itemImageProperties } =
    await getSegmentedItemProperties(item)

  if (!relatedItemProperty && options?.onlyHtmlStorageSeedLocalIds?.length) {
    const storageSeedUploads = await getStorageSeedUploads(itemImageProperties, options)
    uploads.push(...storageSeedUploads)
    return uploads
  }

  for (const uploadProperty of itemUploadProperties) {
    uploads = await processUploadProperty(
      uploadProperty,
      uploads,
      relatedItemProperty,
      options,
    )
  }

  const storageSeedUploads = await getStorageSeedUploads(itemImageProperties, options)
  uploads.push(...storageSeedUploads)

  if (!relatedItemProperty && !options?.onlyHtmlStorageSeedLocalIds?.length) {
    uploads = await appendCoPublishedImageUploads(item, uploads, options)
  }

  if (options?.skipRelationRecursion) {
    return uploads
  }

  for (const relationProperty of itemRelationProperties) {
    const snapshot = relationProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) {
      continue
    }
    const propertyValue = (context as any).propertyValue

    if (!propertyValue || relationProperty.uid) {
      continue
    }

    const { seedLocalId, seedUid } = resolveSeedIdsFromRefString(
      normalizeRelationPropertyValue(propertyValue) ?? '',
    )
    if (!seedLocalId && !seedUid) {
      throw new Error(
        `Invalid relation value for ${relationProperty.propertyName}: expected local seed id or 0x uid`,
      )
    }

    const relatedItem = await Item.find({
      seedLocalId,
      seedUid,
    })

    if (!relatedItem) {
      throw new Error(
        `No relatedItem found for ${relationProperty.propertyName}`,
      )
    }

    uploads = await getPublishUploads(relatedItem, uploads, relationProperty, options)
  }

  return uploads
}
