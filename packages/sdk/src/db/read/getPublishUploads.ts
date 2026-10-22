import { BaseFileManager } from '@/helpers'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { storageUploadPath } from '@/storageValue/resolve'
import { BaseArweaveClient } from '@seedprotocol/arweave'
import debug from 'debug'
import { buildArweaveContentTags, getContentSha256 } from '@/helpers/arweaveContentTags'
import type { TransactionTag } from '@seedprotocol/arweave'
import type { PublishUpload, PublishUploadData } from '@/types/publish'
import { findEmbeddedImageFilePath } from '@/helpers/htmlEmbeddedDataUriPublish'
import { ModelPropertyDataTypes, isDataType } from '@/helpers/property'
import { resolveUploadMimeType } from '@/helpers/mimeTypes'
import { mapWithConcurrency } from '@/helpers/mapWithConcurrency'
import { encodeCompositeUpload, type CompositeChild } from '@/helpers/compositeUpload'
import {
  getPublishGraph,
  type PublishGraph,
  type PublishGraphNode,
  type PublishGraphProperty,
} from '@/db/read/publishGraph'

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
}

type UploadTarget = Pick<
  PublishUploadData,
  'itemPropertyName' | 'itemPropertyLocalId' | 'seedLocalId' | 'versionLocalId'
>

/**
 * One upload a publish makes, before its bytes are read: a storage seed's file, an embedded
 * image's file, or a composite of a node's ItemStorage files. Keyed by the seed whose
 * storageTransactionId attests it.
 */
export type PublishUploadSource = UploadTarget & {
  /** A single file (`filePath`), or a composite of ItemStorage files (`children`). */
  filePath?: string
  children?: { name: string; filePath: string }[]
  /** A saved ItemStorage edit whose file is gone: the paths tried, per property. */
  missingLocalEdits?: { name: string; tried: string[] }[]
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

const isUsablePath = (filePath: string | void | null | undefined): filePath is string =>
  !!filePath && !filePath.endsWith('undefined') && !filePath.endsWith('null')

/**
 * Local file of one ItemStorage property of a node. Tries, in order: its current row's
 * refResolvedValue + localStorageDir, then (for a local draft, or no row) the name saveItemStorage
 * gives a new file (`<seedUid or seedLocalId><extension>` in the model's storage directory). A
 * published or derived row is never swapped for a local file of another name: that file would be
 * older content.
 *
 * `missingLocalEdit` lists the paths tried when nothing exists although the row is a saved local
 * edit (no attestation uid, not derived from one, refResolvedValue set by saveItemStorage): that
 * edit's file should be there. A published or derived row without a file (e.g. content not
 * downloaded, or a property the composite never had) is skipped.
 */
export const resolveItemStorageChildFile = async (
  node: Pick<PublishGraphNode, 'seedLocalId' | 'seedUid'>,
  property: Pick<PublishGraphProperty, 'definition' | 'row'>,
): Promise<{ filePath?: string; missingLocalEdit?: string[] }> => {
  const tried: string[] = []
  const tryPath = async (filePath: string | void | null | undefined): Promise<string | undefined> => {
    if (!isUsablePath(filePath) || tried.includes(filePath)) return undefined
    tried.push(filePath)
    return (await BaseFileManager.pathExists(filePath)) ? filePath : undefined
  }

  const { row, definition } = property
  const dir = getItemStorageSubdir(definition.localStorageDir || row?.localStorageDir)

  if (row?.refResolvedValue) {
    const fromRow = await tryPath(BaseFileManager.getFilesPath(dir, row.refResolvedValue))
    if (fromRow) return { filePath: fromRow }
  }

  const isLocalDraft = !!row && !row.uid && row.derivedFromUid == null
  const seedIds = !row || isLocalDraft ? [row?.seedUid, node.seedUid, row?.seedLocalId, node.seedLocalId] : []
  for (const seedId of seedIds) {
    if (!seedId) continue
    const derived = await tryPath(
      BaseFileManager.getFilesPath(dir, getItemStorageLocalFileName(seedId, definition.filenameSuffix)),
    )
    if (derived) return { filePath: derived }
  }

  // saveItemStorage sets refResolvedValue on the draft row once the file is written. A draft row
  // without one is the empty row createNewItem makes for every model property: nothing to upload.
  return isLocalDraft && !!row?.refResolvedValue ? { missingLocalEdit: tried } : {}
}

const slotOf = (node: PublishGraphNode) => node.properties.find((p) => p.kind === 'storageTransaction')

/** Where an upload attesting through `node`'s storageTransactionId is recorded. */
const slotTarget = (node: PublishGraphNode): UploadTarget => {
  const slot = slotOf(node)
  return {
    seedLocalId: node.seedLocalId,
    itemPropertyName: slot?.key ?? 'storageTransactionId',
    itemPropertyLocalId: slot?.row?.localId ?? '',
    versionLocalId: slot?.row?.versionLocalId ?? node.version.localId ?? '',
  }
}

/** A node's own files: the ItemStorage properties beside its storageTransactionId, as one composite. */
async function compositeSource(node: PublishGraphNode): Promise<PublishUploadSource | undefined> {
  if (!slotOf(node)) return undefined
  const children: { name: string; filePath: string }[] = []
  const missingLocalEdits: { name: string; tried: string[] }[] = []
  for (const property of node.properties) {
    if (property.kind !== 'itemStorage') continue
    const { filePath, missingLocalEdit } = await resolveItemStorageChildFile(node, property)
    if (filePath) children.push({ name: property.key, filePath })
    else if (missingLocalEdit) missingLocalEdits.push({ name: property.key, tried: missingLocalEdit })
  }
  if (children.length === 0 && missingLocalEdits.length === 0) return undefined
  return { ...slotTarget(node), children, ...(missingLocalEdits.length ? { missingLocalEdits } : {}) }
}

/** The file of a storage seed this publish attests, named by the referring property's row. */
async function storageSeedSource(owner: PublishGraphNode, property: PublishGraphProperty): Promise<PublishUploadSource | undefined> {
  const target = property.refs[0]?.node
  const refResolvedValue = property.row?.refResolvedValue
  if (!target || !refResolvedValue) return undefined
  const filePath = storageUploadPath({
    dataType: property.definition.refValueType ?? property.definition.dataType,
    refResolvedValue,
    localStorageDir: property.row?.localStorageDir,
  })
  if (!(await BaseFileManager.pathExists(filePath))) return undefined
  return {
    seedLocalId: target.seedLocalId,
    itemPropertyName: property.key,
    itemPropertyLocalId: property.row?.localId ?? '',
    versionLocalId: property.row?.versionLocalId ?? owner.version.localId ?? '',
    filePath,
  }
}

const isHtmlStorageProperty = (property: PublishGraphProperty): boolean =>
  isDataType(property.definition.refValueType ?? property.definition.dataType, ModelPropertyDataTypes.Html)

/**
 * Every upload a publish makes, in graph order (the root's first), one per attesting seed. The
 * options select the phases of a publish with Html-embedded images: phase 1 defers the listed Html
 * storage seeds, phase 2 uploads only those.
 */
export async function getPublishUploadSources(
  graph: PublishGraph,
  options?: GetPublishUploadsOptions,
): Promise<PublishUploadSource[]> {
  const onlyHtml = options?.onlyHtmlStorageSeedLocalIds?.length ? new Set(options.onlyHtmlStorageSeedLocalIds) : undefined
  const deferHtml = new Set(options?.deferHtmlStorageSeedLocalIds ?? [])
  const sources: PublishUploadSource[] = []
  const add = (source: PublishUploadSource | undefined) => {
    if (source && !sources.some((s) => s.seedLocalId === source.seedLocalId)) sources.push(source)
  }

  for (const node of [graph.root, ...graph.nodes.filter((n) => n !== graph.root)]) {
    if (!onlyHtml) add(await compositeSource(node))
    if (node.kind !== 'root' && node.kind !== 'draft') continue
    for (const property of node.properties) {
      if (property.kind !== 'storageSeed' || property.deferred) continue
      const seedLocalId = property.refs[0]?.node?.seedLocalId
      if (!seedLocalId) continue
      if (isHtmlStorageProperty(property) ? deferHtml.has(seedLocalId) || (onlyHtml && !onlyHtml.has(seedLocalId)) : onlyHtml) continue
      add(await storageSeedSource(node, property))
    }
    if (onlyHtml) continue
    for (const row of node.embeddedImages) {
      const image = graph.nodes.find((n) => n.seedLocalId === row.imageSeedLocalId && n.kind === 'embeddedImage')
      const filePath = image ? await findEmbeddedImageFilePath(image.seedLocalId) : undefined
      if (image && filePath) add({ ...slotTarget(image), filePath })
    }
  }
  return sources
}

/** The bytes of one source; a missing local ItemStorage edit fails the publish. */
async function readSource(source: PublishUploadSource, options: GetPublishUploadsOptions | undefined): Promise<PublishUploadData> {
  const { filePath, children, missingLocalEdits, ...target } = source
  const missing = missingLocalEdits?.[0]
  if (missing) {
    // Uploading without it would publish a composite that silently lacks this edit.
    throw new Error(
      `Cannot publish ${source.seedLocalId}: the local file for ${missing.name} ` +
        `was not found (looked in ${missing.tried.join(', ')})`,
    )
  }
  if (children) {
    // Composite of the node's ItemStorage files; see helpers/compositeUpload.ts for the format.
    // Children are read as bytes: a binary child is base64-framed instead of decoded as text.
    const parts: CompositeChild[] = []
    for (const child of children) parts.push({ name: child.name, bytes: (await readUploadFile(child.filePath)).bytes })
    return buildPublishUploadData(encodeCompositeUpload(parts), 'application/octet-stream', target, options)
  }
  const { bytes, contentType } = await readUploadFile(filePath!)
  return buildPublishUploadData(bytes, contentType, target, options)
}

/** Fails like a publish would when an item's relation names a seed that isn't there. */
function assertRefsResolve(graph: PublishGraph): void {
  for (const broken of graph.brokenRefs) {
    if (broken.list) continue
    throw new Error(
      broken.reason === 'invalid'
        ? `Invalid relation value for ${broken.propertyKey}: expected local seed id or 0x uid`
        : `No relatedItem found for ${broken.propertyKey}`,
    )
  }
}

/**
 * True if publish would include at least one Arweave upload (local file / storage seed present,
 * or a saved local edit whose file is missing, which the upload then reports). Reads rows and
 * file metadata only, for routing (e.g. skip the Arweave steps).
 */
export async function itemHasPublishUploadCandidates(item: { seedLocalId: string; modelName?: string }): Promise<boolean> {
  const graph = await getPublishGraph(item)
  assertRefsResolve(graph)
  return (await getPublishUploadSources(graph)).length > 0
}

/**
 * Upload data for a publish of `item`: its own, and that of every seed the publish attests with it
 * (see publishGraph.ts). Raw bytes plus Content-SHA-256 / Content-Type / configured tags; no
 * Arweave transaction is created, so this does not touch the network. The bundler path in
 * `@seedprotocol/publish` signs these as DataItems; {@link getPublishUploads} turns them into L1
 * transactions.
 */
export const getPublishUploadData = async (
  item: { seedLocalId: string; modelName?: string },
  options?: GetPublishUploadsOptions,
): Promise<PublishUploadData[]> => {
  // Every edit made before publishing is in `metadata` and its files first (ADR 0019)
  const { waitForPendingOutboxOps } = await import('@/outbox')
  await waitForPendingOutboxOps()
  const graph = await getPublishGraph(item)
  assertRefsResolve(graph)
  const sources = await getPublishUploadSources(graph, options)
  logger('%d uploads for %s', sources.length, item.seedLocalId)
  const uploads: PublishUploadData[] = []
  for (const source of sources) uploads.push(await readSource(source, options))
  return uploads
}

/**
 * Arweave L1 transactions for a publish of `item`: {@link getPublishUploadData}, each made into an
 * unsigned transaction carrying the same tags.
 */
export const getPublishUploads = async (
  item: { seedLocalId: string; modelName?: string },
  options?: GetPublishUploadsOptions,
): Promise<PublishUpload[]> => {
  const uploadData = await getPublishUploadData(item, options)
  // Each createTransaction fetches the price / anchor from the gateway: run a few at once.
  return mapWithConcurrency(uploadData, CREATE_TRANSACTION_CONCURRENCY, async (upload) => ({
    itemPropertyName: upload.itemPropertyName,
    itemPropertyLocalId: upload.itemPropertyLocalId,
    seedLocalId: upload.seedLocalId,
    versionLocalId: upload.versionLocalId,
    transactionToSign: await BaseArweaveClient.createTransaction(upload.data, {
      tags: upload.tags.length ? upload.tags : undefined,
    }),
  }))
}
