import { INTERNAL_STORAGE_MODEL_FILE_IDS } from '@/helpers/constants'
import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import {
  getPublicArweaveRawUrl,
  normalizeRelationPropertyValue,
  resolveSeedIdsFromRefString,
  rewriteHtmlAttributes,
} from '@seedprotocol/arweave'
import { getContentHash } from '@/helpers/crypto'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { Item } from '@/Item/Item'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import { ModelPropertyDataTypes, normalizeDataType, type HtmlEmbeddedDataUriPolicy } from '@/helpers/property'
import { findSeedRow } from '@/db/read/findSeedRow'
import { storageSeedTransactionId } from '@/storageValue/resolve'
import {
  getPublishGraph,
  publishGraphItemNodes,
  type EmbeddedImageRow,
  type PublishGraphNode,
} from '@/db/read/publishGraph'
import { getExtensionForMimeType } from '@/helpers/mimeTypes'

export const HTML_EMBEDDED_MAX_IMAGES_PER_DOC = 50
export const HTML_EMBEDDED_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const HTML_EMBEDDED_MAX_TOTAL_BYTES = 25 * 1024 * 1024

const DATA_URI_IMAGE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/i

const MIME_NORMALIZE: Record<string, string> = {
  'image/jpg': 'image/jpeg',
}

function normalizeMime(m: string): string {
  const lower = m.toLowerCase().trim()
  return MIME_NORMALIZE[lower] ?? lower
}

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

export type HtmlEmbeddedExtractEntry = {
  dataUri: string
  stableKey: string
  byteLength: number
  mimeType: string
  /** The image's decoded bytes. */
  bytes: Uint8Array
}

export class HtmlEmbeddedDataUriLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HtmlEmbeddedDataUriLimitError'
  }
}

export function resolveEffectiveHtmlEmbeddedDataUriPolicy(
  propertyDef: { dataType?: string; htmlEmbeddedDataUriPolicy?: HtmlEmbeddedDataUriPolicy } | undefined,
  publishLevel?: HtmlEmbeddedDataUriPolicy,
): HtmlEmbeddedDataUriPolicy {
  const fromProp = propertyDef?.htmlEmbeddedDataUriPolicy
  if (fromProp === 'materialize' || fromProp === 'preserve') return fromProp
  if (publishLevel === 'materialize' || publishLevel === 'preserve') return publishLevel
  return 'materialize'
}

function getAttr(node: DefaultTreeAdapterTypes.Element, name: string): string | undefined {
  const a = node.attrs?.find((x) => x.name === name)
  return a?.value
}

/**
 * Walk fragment tree; collect unique data:image base64 URIs with limits.
 */
export async function extractDataUriImagesFromHtml(html: string): Promise<HtmlEmbeddedExtractEntry[]> {
  const fragment = parseFragment(html)
  const found: HtmlEmbeddedExtractEntry[] = []
  const seenUris = new Set<string>()
  let totalBytes = 0

  const walk = async (node: DefaultTreeAdapterTypes.ChildNode): Promise<void> => {
    if (node.nodeName === '#text' || node.nodeName === '#comment') return
    const el = node as DefaultTreeAdapterTypes.Element
    if (el.tagName === 'img') {
      const src = getAttr(el, 'src')?.trim()
      if (src && src.startsWith('data:image/')) {
        const m = DATA_URI_IMAGE.exec(src)
        if (m) {
          const mimeRaw = normalizeMime(m[1]!)
          if (!ALLOWED_MIMES.has(mimeRaw)) {
            throw new HtmlEmbeddedDataUriLimitError(
              `Unsupported embedded image type: ${mimeRaw}. Allowed: ${[...ALLOWED_MIMES].join(', ')}`,
            )
          }
          let binary: Uint8Array
          try {
            const b64 = m[2]!.replace(/\s/g, '')
            binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          } catch {
            throw new HtmlEmbeddedDataUriLimitError('Invalid base64 in embedded image data URI')
          }
          const byteLength = binary.byteLength
          if (byteLength > HTML_EMBEDDED_MAX_IMAGE_BYTES) {
            throw new HtmlEmbeddedDataUriLimitError(
              `Embedded image exceeds max size (${HTML_EMBEDDED_MAX_IMAGE_BYTES} bytes)`,
            )
          }
          totalBytes += byteLength
          if (totalBytes > HTML_EMBEDDED_MAX_TOTAL_BYTES) {
            throw new HtmlEmbeddedDataUriLimitError(
              `Total embedded image size exceeds max (${HTML_EMBEDDED_MAX_TOTAL_BYTES} bytes)`,
            )
          }
          if (!seenUris.has(src)) {
            if (seenUris.size >= HTML_EMBEDDED_MAX_IMAGES_PER_DOC) {
              throw new HtmlEmbeddedDataUriLimitError(
                `Too many distinct embedded images (max ${HTML_EMBEDDED_MAX_IMAGES_PER_DOC})`,
              )
            }
            seenUris.add(src)
            const stableKey = await getContentHash(binary)
            found.push({ dataUri: src, stableKey, byteLength, mimeType: mimeRaw, bytes: binary })
          }
        }
      }
    }
    const parent = el as DefaultTreeAdapterTypes.ParentNode
    if (parent.childNodes) {
      for (const c of parent.childNodes) await walk(c)
    }
  }

  for (const c of fragment.childNodes) await walk(c as DefaultTreeAdapterTypes.ChildNode)
  return found
}

/**
 * Replace `data:image/...` `<img src>` values with Arweave URLs (keyed by data URI). Only those
 * `src` attributes change; the rest of the Html is kept byte for byte.
 */
export function replaceDataUrisInParsedHtml(
  html: string,
  replacements: Map<string, string>,
): string {
  if (replacements.size === 0) return html
  return rewriteHtmlAttributes(html, (el, attrName, value) => {
    if (el.tagName !== 'img' || attrName !== 'src') return undefined
    return replacements.get(value.trim())
  })
}

/**
 * `seed:property/<propertyName>` in Html stands for the Arweave URL of the same item's
 * `<propertyName>` storage property (Image, File or Json). Publish uploads that property first,
 * then rewrites the placeholder to its gateway URL before the Html is uploaded, so Html can show a
 * file published alongside it without embedding it (e.g. `<img class="u-featured"
 * src="seed:property/featureImage">`).
 */
export const SEED_PROPERTY_REF_PREFIX = 'seed:property/'
const SEED_PROPERTY_REF = /^seed:property\/([A-Za-z_$][A-Za-z0-9_$]*)$/
/** Attributes whose whole (trimmed) value may be a `seed:property/` placeholder. */
const SEED_PROPERTY_REF_ATTRIBUTES = new Set(['src', 'href', 'poster'])

const seedPropertyRefName = (attrName: string, value: string): string | undefined =>
  SEED_PROPERTY_REF_ATTRIBUTES.has(attrName) ? SEED_PROPERTY_REF.exec(value.trim())?.[1] : undefined

/** A `seed:property/` placeholder that names no usable property, or whose upload is unknown. */
export class HtmlSeedPropertyRefError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HtmlSeedPropertyRefError'
  }
}

/** Property names referenced by `seed:property/<name>` placeholders in `html`, each once. */
export function findSeedPropertyRefsInHtml(html: string): string[] {
  if (!html.includes(SEED_PROPERTY_REF_PREFIX)) return []
  const names = new Set<string>()
  rewriteHtmlAttributes(html, (_el, attrName, value) => {
    const name = seedPropertyRefName(attrName, value)
    if (name) names.add(name)
    return undefined
  })
  return [...names]
}

/** Replace `seed:property/<name>` placeholders with `urlByPropertyName.get(name)`; other bytes are kept. */
export function replaceSeedPropertyRefsInHtml(html: string, urlByPropertyName: Map<string, string>): string {
  if (urlByPropertyName.size === 0) return html
  return rewriteHtmlAttributes(html, (_el, attrName, value) => {
    const name = seedPropertyRefName(attrName, value)
    return name ? urlByPropertyName.get(name) : undefined
  })
}

const SEED_PROPERTY_REF_DATA_TYPES = [
  ModelPropertyDataTypes.Image,
  ModelPropertyDataTypes.File,
  ModelPropertyDataTypes.Json,
] as string[]

/**
 * The storage property of `node` a `seed:property/<name>` placeholder names, and the seed it holds.
 * Html properties are refused: an Html seed may itself be deferred to after the rewrite.
 */
function resolveSeedPropertyRefTarget(
  node: PublishGraphNode,
  propertyName: string,
): { seedLocalId?: string; seedUid?: string } {
  const property = node.properties.find((p) => p.key === propertyName)
  if (!property) {
    throw new HtmlSeedPropertyRefError(
      `Html references ${SEED_PROPERTY_REF_PREFIX}${propertyName}, but ${node.modelName} has no property ${propertyName}`,
    )
  }
  const def = property.definition
  const dataType = normalizeDataType(def.dataType)
  const storageType = dataType === ModelPropertyDataTypes.Relation ? normalizeDataType(def.refValueType) : dataType
  if (!SEED_PROPERTY_REF_DATA_TYPES.includes(storageType)) {
    throw new HtmlSeedPropertyRefError(
      `Html references ${SEED_PROPERTY_REF_PREFIX}${propertyName}, but ${propertyName} is ${def.dataType}; ` +
        `only Image, File and Json properties can be referenced`,
    )
  }
  const ids = resolveSeedIdsFromRefString(normalizeRelationPropertyValue(property.row?.propertyValue) ?? '')
  if (!ids.seedLocalId && !ids.seedUid) {
    throw new HtmlSeedPropertyRefError(
      `Html references ${SEED_PROPERTY_REF_PREFIX}${propertyName}, but ${propertyName} has no value`,
    )
  }
  return ids
}

const ARWEAVE_TX_ID = /^[a-z0-9_-]{43}$/i

/**
 * The Arweave tx of the storage seed a placeholder names: uploaded in this publish's phase 1, or,
 * when not uploaded now, the transaction it was published with (its storageTransactionId row).
 */
async function resolveSeedPropertyRefTxId(
  node: PublishGraphNode,
  propertyName: string,
  txBySeedLocalId: Map<string, string>,
): Promise<string> {
  const target = resolveSeedPropertyRefTarget(node, propertyName)
  const uploaded = target.seedLocalId ? txBySeedLocalId.get(target.seedLocalId) : undefined
  if (uploaded) return uploaded

  const recorded = await storageSeedTransactionId(target)
  if (recorded && ARWEAVE_TX_ID.test(recorded)) return recorded

  throw new HtmlSeedPropertyRefError(
    `Html references ${SEED_PROPERTY_REF_PREFIX}${propertyName}, but ${propertyName} was not uploaded ` +
      `in this publish and has no published transaction`,
  )
}

export type PrepareHtmlEmbeddedImagesResult = {
  /** Html storage seed local ids that must be uploaded in phase 2 (after image txs + rewrite). */
  deferredHtmlSeedLocalIds: string[]
}

/**
 * Name of the file holding an embedded image's bytes in the images folder: `<imageSeedLocalId>.<ext>`,
 * the extension following the image's MIME type (one of {@link ALLOWED_MIMES}).
 */
export function embeddedImageFileName(imageSeedLocalId: string, mimeType: string): string {
  return `${imageSeedLocalId}.${getExtensionForMimeType(mimeType) ?? 'bin'}`
}

/** Path of the file {@link createImageItemFromBytes} wrote for an Image seed, or undefined if there is none. */
export async function findEmbeddedImageFilePath(imageSeedLocalId: string): Promise<string | undefined> {
  for (const mimeType of ALLOWED_MIMES) {
    const filePath = BaseFileManager.getFilesPath('images', embeddedImageFileName(imageSeedLocalId, mimeType))
    if (await BaseFileManager.pathExists(filePath)) return filePath
  }
  return undefined
}

/**
 * Create an Image item for an embedded image and write its bytes to the images folder, where publish
 * reads them for upload ({@link findEmbeddedImageFilePath}). Its storageTransactionId stays empty
 * until the upload writes the transaction id, as for any other storage seed.
 */
export async function createImageItemFromBytes(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ seedLocalId: string }> {
  const imageItem = await Item.create({
    modelName: 'Image',
    modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS.image,
  })
  await waitForEntityReady(imageItem, { timeout: 60_000 })
  const filePath = BaseFileManager.getFilesPath('images', embeddedImageFileName(imageItem.seedLocalId, mimeType))
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('images'))
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  try {
    await BaseFileManager.saveFile(filePath, data)
  } catch {
    const fs = await BaseFileManager.getFs()
    fs.writeFileSync(filePath, bytes)
  }
  const { seedLocalId } = imageItem
  // Publish reads the image from its rows when it uploads and attests it
  imageItem.unload()
  return { seedLocalId }
}

/** The Html properties of a node with a stored Html seed and file name. */
const htmlValuesOf = (node: PublishGraphNode) =>
  node.properties.flatMap((property) => {
    if (normalizeDataType(property.definition.dataType) !== ModelPropertyDataTypes.Html) return []
    const htmlSeedLocalId = property.row?.propertyValue?.trim()
    const fileName = property.row?.refResolvedValue
    return htmlSeedLocalId && fileName ? [{ property, htmlSeedLocalId, filePath: `${BaseFileManager.getFilesPath('html')}/${fileName}` }] : []
  })

/**
 * Scan Html storage properties, materialize embedded images as Image items, insert co-publish rows.
 * Call before phase-1 Arweave tx build. Does not rewrite Html files yet.
 */
export async function prepareHtmlEmbeddedImagesForPublish(
  item: { seedLocalId: string; modelName?: string },
  publishPolicy: HtmlEmbeddedDataUriPolicy | undefined,
): Promise<PrepareHtmlEmbeddedImagesResult> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) {
    return { deferredHtmlSeedLocalIds: [] }
  }
  const deferred = new Set<string>()
  // The item's own Html, and the Html of the draft items published with it: each gets its embedded
  // images materialized and co-published (rows keyed by the item owning the Html property).
  const graph = await getPublishGraph(item)
  for (const node of publishGraphItemNodes(graph)) {
    await prepareHtmlEmbeddedImagesOfNode(appDb, node, publishPolicy, deferred)
  }

  return { deferredHtmlSeedLocalIds: [...deferred] }
}

/**
 * An embedded image an earlier attempt materialized for this data URI that can be used again: its
 * Image seed is still a local draft and its file is there.
 */
async function reusableImage(row: EmbeddedImageRow | undefined): Promise<string | undefined> {
  if (!row) return undefined
  const seed = await findSeedRow({ localId: row.imageSeedLocalId })
  if (!seed || isValidEasAttestationUid(seed.uid)) return undefined
  return (await findEmbeddedImageFilePath(row.imageSeedLocalId)) ? row.imageSeedLocalId : undefined
}

async function prepareHtmlEmbeddedImagesOfNode(
  appDb: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  node: PublishGraphNode,
  publishPolicy: HtmlEmbeddedDataUriPolicy | undefined,
  deferred: Set<string>,
): Promise<void> {
  // An earlier attempt's rows: their images are reused for the same Html and data URI
  const earlier = node.embeddedImages
  const kept: EmbeddedImageRow[] = []

  for (const { property, htmlSeedLocalId, filePath } of htmlValuesOf(node)) {
    if (!(await BaseFileManager.pathExists(filePath))) continue
    const html = await BaseFileManager.readFileAsString(filePath)

    // seed:property/ placeholders are filled in after phase 1 whatever the data URI policy. A
    // placeholder naming no usable property fails here, before anything is uploaded.
    const refs = findSeedPropertyRefsInHtml(html)
    for (const name of refs) resolveSeedPropertyRefTarget(node, name)
    if (refs.length > 0) deferred.add(htmlSeedLocalId)

    // The policy is the row's definition (a schema file's htmlEmbeddedDataUriPolicy or a code-defined one)
    const policy = resolveEffectiveHtmlEmbeddedDataUriPolicy(property.definition, publishPolicy)
    if (policy !== 'materialize') continue

    const extracted = await extractDataUriImagesFromHtml(html)
    if (extracted.length === 0) continue

    deferred.add(htmlSeedLocalId)

    for (const ent of extracted) {
      const previous = earlier.find((r) => r.htmlSeedLocalId.trim() === htmlSeedLocalId && r.stableKey === ent.stableKey)
      const reused = await reusableImage(previous)
      if (reused) {
        kept.push(previous!)
        continue
      }
      const { seedLocalId: imageSeedLocalId } = await createImageItemFromBytes(ent.bytes, ent.mimeType)
      if (previous) await appDb.delete(htmlEmbeddedImageCoPublish).where(eq(htmlEmbeddedImageCoPublish.id, previous.id))
      await appDb.insert(htmlEmbeddedImageCoPublish).values({
        parentSeedLocalId: node.seedLocalId,
        htmlSeedLocalId,
        imageSeedLocalId,
        stableKey: ent.stableKey,
        createdAt: Date.now(),
      }).onConflictDoNothing()
    }
  }

  // Rows for Html or data URIs no longer there
  for (const row of earlier) {
    if (kept.includes(row)) continue
    await appDb.delete(htmlEmbeddedImageCoPublish).where(eq(htmlEmbeddedImageCoPublish.id, row.id))
  }
}

export type UploadedTx = { txId: string; seedLocalId?: string; versionLocalId?: string }

/**
 * After phase-1 uploads, rewrite Html files on disk: data URI → Arweave gateway URL, and
 * `seed:property/<name>` → the gateway URL of that property's upload.
 *
 * `deferredHtmlSeedLocalIds` (from {@link prepareHtmlEmbeddedImagesForPublish}) limits the rewrite to
 * the Html held back from phase 1; without it, every Html of the item and its co-published drafts is
 * considered.
 */
export async function rewriteHtmlEmbeddedImagesOnDisk(
  parentSeedLocalId: string,
  uploadedTransactions: UploadedTx[],
  deferredHtmlSeedLocalIds?: string[],
): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return

  const txBySeedLocalId = new Map<string, string>()
  for (const u of uploadedTransactions) {
    if (u.seedLocalId && u.txId) {
      txBySeedLocalId.set(u.seedLocalId.trim(), u.txId.trim())
    }
  }
  const deferred = deferredHtmlSeedLocalIds
    ? new Set(deferredHtmlSeedLocalIds.map((id) => id.trim()))
    : undefined

  // The parent's Html and that of the draft items published with it (see prepareHtmlEmbeddedImagesForPublish).
  const graph = await getPublishGraph({ seedLocalId: parentSeedLocalId })
  for (const node of publishGraphItemNodes(graph)) {
    await rewriteHtmlEmbeddedImagesOfNode(node, txBySeedLocalId, deferred)
  }
}

async function rewriteHtmlEmbeddedImagesOfNode(
  node: PublishGraphNode,
  txBySeedLocalId: Map<string, string>,
  deferred: Set<string> | undefined,
): Promise<void> {
  for (const { htmlSeedLocalId, filePath } of htmlValuesOf(node)) {
    if (deferred && !deferred.has(htmlSeedLocalId)) continue
    if (!(await BaseFileManager.pathExists(filePath))) continue

    const html = await BaseFileManager.readFileAsString(filePath)

    const replacements = new Map<string, string>()
    const entries = await extractDataUriImagesFromHtml(html)
    for (const r of node.embeddedImages) {
      if (r.htmlSeedLocalId.trim() !== htmlSeedLocalId) continue
      const txId = txBySeedLocalId.get(r.imageSeedLocalId.trim())
      const dataUri = entries.find((e) => e.stableKey === r.stableKey)?.dataUri
      if (txId && dataUri) replacements.set(dataUri, getPublicArweaveRawUrl(txId))
    }

    const urlByPropertyName = new Map<string, string>()
    for (const name of findSeedPropertyRefsInHtml(html)) {
      const txId = await resolveSeedPropertyRefTxId(node, name, txBySeedLocalId)
      urlByPropertyName.set(name, getPublicArweaveRawUrl(txId))
    }

    const newHtml = replaceSeedPropertyRefsInHtml(replaceDataUrisInParsedHtml(html, replacements), urlByPropertyName)
    if (newHtml === html) continue

    try {
      await BaseFileManager.saveFile(filePath, newHtml)
    } catch {
      const fs = await BaseFileManager.getFs()
      fs.writeFileSync(filePath, newHtml)
    }
  }
}

/**
 * Remove co-publish rows after a successful publish for this parent seed.
 */
export async function clearHtmlEmbeddedImageCoPublishRows(parentSeedLocalId: string): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb || !parentSeedLocalId) return
  await appDb
    .delete(htmlEmbeddedImageCoPublish)
    .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, parentSeedLocalId.trim()))
}
