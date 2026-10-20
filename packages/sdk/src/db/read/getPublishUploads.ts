import { BaseFileManager } from '@/helpers'
import {
  getStorageDirForDataType,
  getItemStorageLocalFileName,
  getItemStorageSubdir,
} from '@/helpers/storageDir'
import {
  isPublishedSeedRef,
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
} from '@/helpers/relationSeedRef'
import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import debug from 'debug'
import { IItem, IItemProperty } from '@/interfaces'
import { buildArweaveContentTags, getContentSha256 } from '@/helpers/arweaveContentTags'
import { Item } from '@/Item/Item'
import type { ArweaveTransaction, TransactionTag } from '@/types/arweave'
import type { PublishUpload, PublishUploadData } from '@/types/publish'
import { BaseDb } from '@/db/Db/BaseDb'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { findEmbeddedImageFilePath } from '@/helpers/htmlEmbeddedDataUriPublish'
import { and, eq } from 'drizzle-orm'
import { metadata, type MetadataType } from '@/seedSchema'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'
import { ModelPropertyDataTypes, isDataType } from '@/helpers/property'
import { getPublishDraftGraph } from '@/db/read/publishDraftGraph'
import { resolveUploadMimeType } from '@/helpers/mimeTypes'
import { mapWithConcurrency } from '@/helpers/mapWithConcurrency'
import { encodeCompositeUpload, type CompositeChild } from '@/helpers/compositeUpload'

const logger = debug('seedSdk:item:getPublishUploads')

/** L1 transactions {@link getPublishUploads} creates at once (each asks the gateway for price and anchor). */
export const CREATE_TRANSACTION_CONCURRENCY = 4

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

const toUint8Array = async (data: Buffer | Blob): Promise<Uint8Array> => {
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer())
  }
  return new Uint8Array(data as Buffer)
}

/** A local file's bytes plus its MIME type: the Blob's own type, else the name's extension, else a sniff of the bytes. */
const readUploadFile = async (
  filePath: string,
  fileName: string = filePath,
): Promise<{ bytes: Uint8Array; contentType: string | undefined }> => {
  const data = await BaseFileManager.readFileAsBuffer(filePath)
  const bytes = await toUint8Array(data)
  const sourceType = typeof Blob !== 'undefined' && data instanceof Blob ? data.type : undefined
  return { bytes, contentType: resolveUploadMimeType({ sourceType, fileName, bytes }) }
}

export const prepareArweaveTransaction = async (
  data: string | Uint8Array,
  contentHash: string | undefined,
  contentType?: string,
  additionalTags?: TransactionTag[],
): Promise<ArweaveTransaction> => {
  const tags = buildArweaveContentTags(contentHash, contentType, additionalTags)

  const tx = await BaseArweaveClient.createTransaction(data, {
    tags: tags.length ? tags : undefined,
  })

  return tx
}

type UploadTarget = Pick<
  PublishUploadData,
  'itemPropertyName' | 'itemPropertyLocalId' | 'seedLocalId' | 'versionLocalId'
>

/**
 * The one place an upload's bytes become a {@link PublishUploadData}: everything after this
 * (Content-SHA-256, tags, the L1 transaction or the bundler DataItem, signing) works from what it
 * returns. A future private-publish option that encrypts content belongs here, before the hash and
 * tags are computed, so both publish paths pick it up.
 */
const buildPublishUploadData = (
  data: Uint8Array,
  contentType: string | undefined,
  target: UploadTarget,
  options: GetPublishUploadsOptions | undefined,
): PublishUploadData => {
  const contentHash = getContentSha256(data)
  return {
    data,
    contentHash,
    contentType,
    tags: buildArweaveContentTags(contentHash, contentType, options?.arweaveUploadTags),
    ...target,
  }
}



const getStorageSeedUploadData = async (
  itemStorageSeedProperties: IItemProperty<any>[],
  options?: GetPublishUploadsOptions,
): Promise<PublishUploadData[]> => {
  const uploads: PublishUploadData[] = []

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

    if (isDataType(dataType, ModelPropertyDataTypes.Html)) {
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

    const { bytes: fileContents, contentType } = await readUploadFile(filePath, refResolvedValue)

    uploads.push(
      buildPublishUploadData(
        fileContents,
        contentType,
        {
          itemPropertyName: itemProperty.propertyName,
          itemPropertyLocalId: itemProperty.localId,
          seedLocalId,
          versionLocalId: itemProperty.versionLocalId!,
        },
        options,
      ),
    )
  }

  return uploads
}

async function appendCoPublishedImageUploadData(
  item: IItem<any>,
  uploads: PublishUploadData[],
  options?: GetPublishUploadsOptions,
): Promise<PublishUploadData[]> {
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
    const filePath = await findEmbeddedImageFilePath(imageItem.seedLocalId)

    const more: PublishUploadData[] = []
    if (filePath && st && st.localId && st.versionLocalId) {
      const { bytes, contentType } = await readUploadFile(filePath)
      more.push(
        buildPublishUploadData(
          bytes,
          contentType,
          {
            itemPropertyName: st.propertyName,
            itemPropertyLocalId: st.localId,
            seedLocalId: imageItem.seedLocalId,
            versionLocalId: st.versionLocalId,
          },
          options,
        ),
      )
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

const isUsablePath = (filePath: string | void | null | undefined): filePath is string =>
  !!filePath && !filePath.endsWith('undefined') && !filePath.endsWith('null')

/** The newest metadata row of an ItemStorage property, read from the DB (not the live query). */
const getLatestItemStorageRow = async (
  childProperty: IItemProperty<any>,
): Promise<MetadataType | undefined> => {
  const appDb = BaseDb.getAppDb()
  const seedLocalId = childProperty.seedLocalId
  const propertyName = childProperty.storagePropertyName || childProperty.propertyName
  if (!appDb || !seedLocalId || !propertyName) return undefined
  const where = [eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)]
  if (childProperty.versionLocalId) where.push(eq(metadata.versionLocalId, childProperty.versionLocalId))
  const rows: MetadataType[] = await appDb.select().from(metadata).where(and(...where))
  return [...rows].sort(compareMetadataRowsLatestFirst)[0]
}

/**
 * Local file of one ItemStorage child of a composite upload. Tries, in order: the property's
 * localStoragePath (context set by save / hydration / the live query), its newest metadata row's
 * refResolvedValue + localStorageDir, then (for a local draft, or no row) the name
 * saveItemStorage gives a new file (`<seedUid or seedLocalId><extension>` in the model's storage
 * directory). A published or derived row is never swapped for a local file of another name: that
 * file would be older content.
 *
 * `missingLocalEdit` lists the paths tried when nothing exists although the newest row is a saved
 * local edit (no attestation uid, not derived from one, refResolvedValue set by saveItemStorage):
 * that edit's file should be there. A published or derived row without a file (e.g. content not
 * downloaded, or a property the composite never had) is skipped as before.
 */
export const resolveItemStorageChildFile = async (
  childProperty: IItemProperty<any>,
): Promise<{ filePath?: string; missingLocalEdit?: string[] }> => {
  const tried: string[] = []
  const tryPath = async (filePath: string | void | null | undefined): Promise<string | undefined> => {
    if (!isUsablePath(filePath) || tried.includes(filePath)) return undefined
    tried.push(filePath)
    return (await BaseFileManager.pathExists(filePath)) ? filePath : undefined
  }

  const fromContext = await tryPath(childProperty.localStoragePath)
  if (fromContext) return { filePath: fromContext }

  const row = await getLatestItemStorageRow(childProperty).catch((error) => {
    logger('resolveItemStorageChildFile: metadata lookup failed', error)
    return undefined
  })
  const propertyDef = childProperty.propertyDef
  const dir = getItemStorageSubdir(propertyDef?.localStorageDir || row?.localStorageDir)

  if (row?.refResolvedValue) {
    const fromRow = await tryPath(BaseFileManager.getFilesPath(dir, row.refResolvedValue))
    if (fromRow) return { filePath: fromRow }
  }

  const isLocalDraft = !!row && !row.uid && row.derivedFromUid == null

  const suffix = propertyDef?.filenameSuffix
  const seedIds = !row || isLocalDraft
    ? [row?.seedUid, childProperty.seedUid, row?.seedLocalId, childProperty.seedLocalId]
    : []
  for (const seedId of seedIds) {
    if (!seedId) continue
    const derived = await tryPath(
      BaseFileManager.getFilesPath(dir, getItemStorageLocalFileName(seedId, suffix)),
    )
    if (derived) return { filePath: derived }
  }

  // saveItemStorage sets refResolvedValue on the draft row once the file is written. A draft row
  // without one is the empty row createNewItem makes for every model property: nothing to upload.
  return isLocalDraft && !!row?.refResolvedValue ? { missingLocalEdit: tried } : {}
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

  for (const childProperty of uploadProperty.childProperties) {
    // Not strict: a local edit whose file is missing still means "would upload", so the publish
    // goes ahead and fails loudly in processUploadPropertyData instead of skipping the upload.
    const resolved = await resolveItemStorageChildFile(childProperty)
    if (resolved.filePath || resolved.missingLocalEdit) {
      return true
    }
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

async function itemOwnUploadCandidates(
  item: IItem<any>,
  relatedItemProperty: IItemProperty<any> | undefined,
  recurseStorageRelations: boolean,
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

  if (!recurseStorageRelations) return false
  const storageProperties = new Set(itemImageProperties)
  for (const relationProperty of itemRelationProperties) {
    if (!storageProperties.has(relationProperty)) continue
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
      // Related seed referenced by attested uid with no local copy: already published, nothing to upload.
      if (isPublishedSeedRef(propertyValue)) continue
      throw new Error(
        `No relatedItem found for ${relationProperty.propertyName}`,
      )
    }

    if (await itemOwnUploadCandidates(relatedItem, relationProperty, false)) {
      return true
    }
  }

  return false
}

/** Same walk as getPublishUploads: the item and the draft items its publish carries along. */
export async function itemHasPublishUploadCandidates(
  item: IItem<any>,
  relatedItemProperty?: IItemProperty<any>,
): Promise<boolean> {
  if (await itemOwnUploadCandidates(item, relatedItemProperty, true)) return true
  const { drafts } = await getPublishDraftGraph(item, { strict: true })
  for (const { item: draft, via, viaList } of drafts) {
    if (await itemOwnUploadCandidates(draft, viaList ? undefined : via, true)) return true
  }
  return false
}

const processUploadPropertyData = async (
  uploadProperty: UploadProperty,
  uploads: PublishUploadData[],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadsOptions,
): Promise<PublishUploadData[]> => {
  const itemProperty = uploadProperty.itemProperty

  const childUploads: ChildUploadData[] = []

  for (const childProperty of uploadProperty.childProperties) {
    const { filePath, missingLocalEdit } = await resolveItemStorageChildFile(childProperty)

    if (!filePath) {
      if (missingLocalEdit) {
        // Uploading without it would publish a composite that silently lacks this edit.
        throw new Error(
          `Cannot publish ${itemProperty.seedLocalId}: the local file for ${childProperty.propertyName} ` +
            `was not found (looked in ${missingLocalEdit.join(', ')})`,
        )
      }
      continue
    }

    childUploads.push({
      propertyName: childProperty.propertyName,
      localStoragePath: filePath,
    })
  }

  let fileContents
  let fileContentType: string | undefined

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
        const read = await readUploadFile(filePath)
        fileContents = read.bytes
        fileContentType = read.contentType
      } catch {
        const fs = await BaseFileManager.getFs()
        fileContents = await toUint8Array(fs.readFileSync(filePath))
        fileContentType = resolveUploadMimeType({ fileName: filePath, bytes: fileContents })
      }
    }
    if (!fileContents) {
      return uploads
    }
  }

  if (childUploads.length > 0) {
    // Composite of the item's ItemStorage files; see helpers/compositeUpload.ts for the format.
    // Children are read as bytes: a binary child is base64-framed instead of decoded as text.
    const children: CompositeChild[] = []
    const fs = await BaseFileManager.getFs()
    for (const childUpload of childUploads) {
      let childUploadContents: Uint8Array | string
      try {
        childUploadContents = await fs.promises.readFile(childUpload.localStoragePath)
      } catch {
        childUploadContents = fs.readFileSync(childUpload.localStoragePath)
      }
      children.push({
        name: childUpload.propertyName,
        bytes:
          typeof childUploadContents === 'string'
            ? new TextEncoder().encode(childUploadContents)
            : new Uint8Array(childUploadContents),
      })
    }
    fileContents = encodeCompositeUpload(children)
  }

  if (!fileContents) {
    throw new Error(`No file contents found for ${itemProperty.propertyName}`)
  }

  const uint8Array = new Uint8Array(fileContents)

  let contentType: string | undefined
  if (childUploads.length === 0 && relatedItemProperty?.localStoragePath) {
    contentType = fileContentType
  } else if (childUploads.length > 0) {
    contentType = 'application/octet-stream'
  }

  const itemPropertyLocalId = relatedItemProperty
    ? relatedItemProperty.localId
    : itemProperty.localId
  const itemPropertyName = relatedItemProperty
    ? relatedItemProperty.propertyName
    : itemProperty.propertyName

  uploads.push(
    buildPublishUploadData(
      uint8Array,
      contentType,
      {
        itemPropertyName,
        itemPropertyLocalId,
        seedLocalId: itemProperty.seedLocalId!,
        versionLocalId: itemProperty.versionLocalId!,
      },
      options,
    ),
  )

  return uploads
}

/** No seed uid yet: a related item in this state is published together with the item. */
const isDraftItem = (item: IItem<any>): boolean =>
  !item.seedUid || item.seedUid === '0x' + '0'.repeat(64)

/** One item's own uploads: its files, storage seeds, Html-embedded images, and the items its storage relations point at. */
const getItemOwnPublishUploadData = async (
  item: IItem<any>,
  uploads: PublishUploadData[],
  relatedItemProperty: IItemProperty<any> | undefined,
  options: GetPublishUploadsOptions | undefined,
): Promise<PublishUploadData[]> => {
  const { itemUploadProperties, itemRelationProperties, itemImageProperties } =
    await getSegmentedItemProperties(item)

  // Phase 2 of an embedded-image publish: only the deferred Html storage seeds, of this item and of
  // the related items published with it (whose Html can embed images too).
  const onlyDeferredHtml = !!options?.onlyHtmlStorageSeedLocalIds?.length
  if (onlyDeferredHtml) {
    const storageSeedUploads = await getStorageSeedUploadData(itemImageProperties, options)
    uploads.push(...storageSeedUploads)
  } else {
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

    // Images embedded in this item's Html: the published item's, and a related draft's published with it.
    if (!relatedItemProperty || isDraftItem(item)) {
      uploads = await appendCoPublishedImageUploadData(item, uploads, options)
    }
  }

  if (options?.skipRelationRecursion) {
    return uploads
  }

  // Relations to Image/File/Html/Json items: their file, read through the relation property.
  const storageProperties = new Set(itemImageProperties)
  for (const relationProperty of itemRelationProperties) {
    if (!storageProperties.has(relationProperty)) continue
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
      // Related seed referenced by attested uid with no local copy: already published, nothing to upload.
      if (isPublishedSeedRef(propertyValue)) continue
      throw new Error(
        `No relatedItem found for ${relationProperty.propertyName}`,
      )
    }

    uploads = await getItemOwnPublishUploadData(relatedItem, uploads, relationProperty, {
      ...options,
      skipRelationRecursion: true,
    })
  }

  return uploads
}

/**
 * Upload data for a publish of `item`: its own, and that of every draft item the publish carries
 * along (reachable through relation and list properties, see publishDraftGraph.ts). Raw bytes plus
 * Content-SHA-256 / Content-Type / configured tags; no Arweave transaction is created, so this
 * does not touch the network. The bundler path in `@seedprotocol/publish` signs these as
 * DataItems; {@link getPublishUploads} turns them into L1 transactions.
 */
export const getPublishUploadData = async (
  item: IItem<any>,
  uploads: PublishUploadData[] = [],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadsOptions,
): Promise<PublishUploadData[]> => {
  uploads = await getItemOwnPublishUploadData(item, uploads, relatedItemProperty, options)

  if (options?.skipRelationRecursion) {
    return uploads
  }

  const { drafts } = await getPublishDraftGraph(item, { strict: true })
  for (const { item: draft, via, viaList } of drafts) {
    uploads = await getItemOwnPublishUploadData(draft, uploads, viaList ? undefined : via, options)
  }

  return uploads
}

/**
 * Arweave L1 transactions for a publish of `item`: {@link getPublishUploadData}, each made into an
 * unsigned transaction carrying the same tags.
 */
export const getPublishUploads = async (
  item: IItem<any>,
  uploads: PublishUpload[] = [],
  relatedItemProperty?: IItemProperty<any>,
  options?: GetPublishUploadsOptions,
): Promise<PublishUpload[]> => {
  // Every edit made before publishing is in `metadata` and its files first (ADR 0019)
  const { waitForPendingOutboxOps } = await import('@/outbox')
  await waitForPendingOutboxOps()
  const uploadData = await getPublishUploadData(item, [], relatedItemProperty, options)
  // Each createTransaction fetches the price / anchor from the gateway: run a few at once.
  const created = await mapWithConcurrency(uploadData, CREATE_TRANSACTION_CONCURRENCY, async (upload) => ({
    itemPropertyName: upload.itemPropertyName,
    itemPropertyLocalId: upload.itemPropertyLocalId,
    seedLocalId: upload.seedLocalId,
    versionLocalId: upload.versionLocalId,
    transactionToSign: await BaseArweaveClient.createTransaction(upload.data, {
      tags: upload.tags.length ? upload.tags : undefined,
    }),
  }))
  uploads.push(...created)
  return uploads
}
