/**
 * Option B: Extract raw file data from Item properties for DataItem creation.
 * Duplicates logic from getPublishUploads but returns raw data instead of transactions.
 * TODO: Replace with shared getPublishUploadData on Item/SDK once experimental path is verified.
 */
import {
  BaseFileManager,
  getCorrectId,
  getSegmentedItemProperties,
  Item,
} from '@seedprotocol/sdk'
import type { IItem, IItemProperty, TransactionTag } from '@seedprotocol/sdk'

/** Optional extra tags appended after Content-SHA-256 / Content-Type (mirrors SDK getPublishUploads). */
export type GetPublishUploadDataOptions = {
  arweaveUploadTags?: TransactionTag[]
}

const buildPublishUploadDataTags = (
  contentHash: string | undefined,
  contentType: string | undefined,
  extra?: TransactionTag[],
): TransactionTag[] => {
  const tags: TransactionTag[] = []
  if (contentHash) tags.push({ name: 'Content-SHA-256', value: contentHash })
  if (contentType) tags.push({ name: 'Content-Type', value: contentType })
  if (extra?.length) tags.push(...extra)
  return tags
}

const getContentHash = async (data: Uint8Array | ArrayBuffer): Promise<string> => {
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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

export type PublishUploadData = {
  data: Uint8Array
  contentHash?: string
  contentType?: string
  /** Full tag list for DataItem / bundler: content tags then configured arweaveUploadTags. */
  tags: TransactionTag[]
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
}

type UploadProperty = {
  itemProperty: IItemProperty<any>
  childProperties: IItemProperty<any>[]
}

type ChildUploadData = {
  propertyName: string
  localStoragePath: string
}

const processUploadPropertyData = async (
  uploadProperty: UploadProperty,
  uploads: PublishUploadData[],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadDataOptions,
): Promise<PublishUploadData[]> => {
  const extra = options?.arweaveUploadTags
  const itemProperty = uploadProperty.itemProperty
  const childUploads: ChildUploadData[] = []

  for (const childProperty of uploadProperty.childProperties) {
    const filePath = childProperty.localStoragePath
    if (!filePath || filePath.endsWith('undefined')) continue
    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) continue
    childUploads.push({
      propertyName: childProperty.propertyName,
      localStoragePath: filePath,
    })
  }

  let fileContents: Uint8Array | undefined

  if (!childUploads || childUploads.length === 0) {
    if (relatedItemProperty?.localStoragePath) {
      const filePath = relatedItemProperty.localStoragePath
      if (filePath && !filePath.endsWith('undefined')) {
        const exists = await BaseFileManager.pathExists(filePath)
        if (exists) {
          try {
            const fileBuffer = await BaseFileManager.readFileAsBuffer(filePath)
            fileContents = await toUint8Array(fileBuffer)
          } catch {
            const fs = await BaseFileManager.getFs()
            fileContents = await toUint8Array(fs.readFileSync(filePath))
          }
        }
      }
    }
  }

  if (childUploads.length > 0) {
    const separator = '===FILE_SEPARATOR==='
    let compositeFileContents = ''
    const fs = await BaseFileManager.getFs()
    for (const childUpload of childUploads) {
      let childUploadContents: Buffer
      try {
        childUploadContents = await fs.promises.readFile(childUpload.localStoragePath)
      } catch {
        childUploadContents = fs.readFileSync(childUpload.localStoragePath)
      }
      compositeFileContents += `${separator}${childUpload.propertyName}${separator}${childUploadContents}`
    }
    fileContents =
      typeof document !== 'undefined'
        ? new TextEncoder().encode(compositeFileContents)
        : new Uint8Array(Buffer.from(compositeFileContents))
  }

  if (!fileContents) return uploads

  const uint8Array = new Uint8Array(fileContents)
  const contentHash = await getContentHash(uint8Array)
  let contentType: string | undefined
  if (childUploads.length === 0 && relatedItemProperty?.localStoragePath) {
    contentType = getMimeTypeFromPath(relatedItemProperty.localStoragePath)
  } else if (childUploads.length > 0) {
    contentType = 'application/octet-stream'
  }

  const itemPropertyLocalId = relatedItemProperty ? relatedItemProperty.localId : itemProperty.localId
  const itemPropertyName = relatedItemProperty ? relatedItemProperty.propertyName : itemProperty.propertyName

  uploads.push({
    data: uint8Array,
    contentHash,
    contentType,
    tags: buildPublishUploadDataTags(contentHash, contentType, extra),
    itemPropertyName,
    itemPropertyLocalId,
    seedLocalId: itemProperty.seedLocalId!,
    versionLocalId: itemProperty.versionLocalId!,
  })
  return uploads
}

const getStorageSeedUploadData = async (
  itemStorageSeedProperties: IItemProperty<any>[],
  options?: GetPublishUploadDataOptions,
): Promise<PublishUploadData[]> => {
  const uploads: PublishUploadData[] = []
  const extra = options?.arweaveUploadTags

  for (const itemProperty of itemStorageSeedProperties) {
    const snapshot = itemProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) continue

    const propertyValue = (context as { propertyValue?: string }).propertyValue
    const refResolvedValue = (context as { refResolvedValue?: string }).refResolvedValue
    if (!refResolvedValue) continue

    const { localId: seedLocalId } = getCorrectId(propertyValue ?? '')
    if (!seedLocalId) continue

    const dataType =
      itemProperty.propertyDef?.refValueType ??
      itemProperty.propertyDef?.dataType ??
      'Image'
    const baseDir = getStorageDirForDataType(dataType)
    const filePath = `${baseDir}/${refResolvedValue}`

    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) continue

    const fileBuffer = await BaseFileManager.readFileAsBuffer(filePath)
    const fileContents = await toUint8Array(fileBuffer)
    const contentHash = await getContentHash(fileContents)
    const contentType = getMimeTypeFromPath(refResolvedValue)

    uploads.push({
      data: fileContents,
      contentHash,
      contentType,
      tags: buildPublishUploadDataTags(contentHash, contentType, extra),
      itemPropertyName: itemProperty.propertyName,
      itemPropertyLocalId: itemProperty.localId,
      seedLocalId,
      versionLocalId: itemProperty.versionLocalId!,
    })
  }
  return uploads
}

export const getPublishUploadData = async (
  item: IItem<any>,
  uploads: PublishUploadData[] = [],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadDataOptions,
): Promise<PublishUploadData[]> => {
  const { itemUploadProperties, itemRelationProperties, itemImageProperties } =
    await getSegmentedItemProperties(item)

  for (const uploadProperty of itemUploadProperties) {
    uploads = await processUploadPropertyData(
      uploadProperty,
      uploads,
      relatedItemProperty,
      options,
    )
  }

  const storageSeedUploads = await getStorageSeedUploadData(itemImageProperties, options)
  uploads.push(...storageSeedUploads)

  for (const relationProperty of itemRelationProperties) {
    const snapshot = relationProperty.getService().getSnapshot()
    const context = 'context' in snapshot ? snapshot.context : null
    if (!context) continue

    const propertyValue = (context as { propertyValue?: string }).propertyValue
    if (!propertyValue || relationProperty.uid) continue

    const { localId: seedLocalId, uid: seedUid } = getCorrectId(propertyValue)
    const relatedItem = await Item.find({ seedLocalId, seedUid } as Parameters<typeof Item.find>[0])
    if (!relatedItem) {
      throw new Error(`No relatedItem found for ${relationProperty.propertyName}`)
    }
    uploads = await getPublishUploadData(relatedItem, uploads, relationProperty, options)
  }

  return uploads
}
