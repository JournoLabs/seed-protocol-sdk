import { INTERNAL_STORAGE_MODEL_FILE_IDS } from '@/helpers/constants'
import { parseFragment } from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getArweaveUrlForTransaction } from '@/helpers'
import { getContentHash } from '@/helpers/crypto'
import type { IItem } from '@/interfaces'
import { Item } from '@/Item/Item'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { ModelPropertyDataTypes, type HtmlEmbeddedDataUriPolicy } from '@/helpers/property'

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
            found.push({ dataUri: src, stableKey, byteLength, mimeType: mimeRaw })
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

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Rewrite attribute values of `html` by splicing each new value into the original string: every
 * byte other than the rewritten attributes stays as written. Re-serializing the parsed tree would
 * not round-trip (parse5 drops the newline the parser eats after `<pre>`/`<textarea>`/`<listing>`,
 * a fragment parse drops doctype/html/head/body, and quoting, case and line endings are normalized),
 * and sealed Html must not change with the serializer.
 *
 * `rewrite` gets each attribute's (entity-decoded) value and returns its new value, or undefined to
 * leave it. A rewritten attribute is written as `name="value"`.
 */
function rewriteHtmlAttributes(
  html: string,
  rewrite: (element: DefaultTreeAdapterTypes.Element, attrName: string, value: string) => string | undefined,
): string {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true })
  const edits: { start: number; end: number; text: string }[] = []
  const walk = (node: DefaultTreeAdapterTypes.ChildNode): void => {
    if (node.nodeName === '#text' || node.nodeName === '#comment') return
    const el = node as DefaultTreeAdapterTypes.Element
    if (el.attrs?.length) {
      for (const attr of el.attrs) {
        if (attr.prefix) continue
        const next = rewrite(el, attr.name, attr.value)
        const location = el.sourceCodeLocation?.attrs?.[attr.name]
        if (next === undefined || !location) continue
        edits.push({
          start: location.startOffset,
          end: location.endOffset,
          text: `${attr.name}="${escapeAttributeValue(next)}"`,
        })
      }
    }
    const parent = el as DefaultTreeAdapterTypes.ParentNode
    if (parent.childNodes) {
      for (const c of parent.childNodes) walk(c)
    }
  }
  for (const c of fragment.childNodes) walk(c as DefaultTreeAdapterTypes.ChildNode)

  let out = html
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
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

export type PrepareHtmlEmbeddedImagesResult = {
  /** Html storage seed local ids that must be uploaded in phase 2 (after image txs + rewrite). */
  deferredHtmlSeedLocalIds: string[]
}

async function deleteCoPublishRowsForParent(appDb: ReturnType<typeof BaseDb.getAppDb>, parentSeedLocalId: string) {
  if (!appDb) return
  await appDb.delete(htmlEmbeddedImageCoPublish).where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, parentSeedLocalId))
}

/**
 * Create an Image item and persist a data URI into its storageTransactionId (same path as user paste).
 */
export async function createImageItemFromDataUri(dataUri: string): Promise<{ seedLocalId: string }> {
  const imageItem = await Item.create({
    modelName: 'Image',
    modelFileId: INTERNAL_STORAGE_MODEL_FILE_IDS.image,
  })
  await waitForEntityIdle(imageItem, { timeout: 60_000 })
  const st =
    imageItem.internalProperties['storageTransactionId'] ??
    imageItem.allProperties['storageTransactionId']
  if (!st) {
    throw new Error('Image item missing storageTransactionId property')
  }
  st.value = dataUri
  await st.save()
  await waitForEntityIdle(imageItem, { timeout: 60_000 })
  return { seedLocalId: imageItem.seedLocalId }
}

/**
 * Scan Html storage properties, materialize embedded images as Image items, insert co-publish rows.
 * Call before phase-1 Arweave tx build. Does not rewrite Html files yet.
 */
export async function prepareHtmlEmbeddedImagesForPublish(
  item: IItem<any>,
  publishPolicy: HtmlEmbeddedDataUriPolicy | undefined,
): Promise<PrepareHtmlEmbeddedImagesResult> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) {
    return { deferredHtmlSeedLocalIds: [] }
  }

  const deferred = new Set<string>()
  // The item's own Html, and the Html of the draft items published with it: each gets its embedded
  // images materialized and co-published (rows keyed by the item owning the Html property).
  for (const parent of [item, ...(await getRelatedDraftsCoPublishedWith(item))]) {
    await prepareHtmlEmbeddedImagesOfItem(appDb, parent, publishPolicy, deferred)
  }

  return { deferredHtmlSeedLocalIds: [...deferred] }
}

/**
 * Draft items (no seed uid yet) that a publish of `item` publishes with it: every draft reachable
 * through relation and list properties, as getPublishPayload and getPublishUploads walk them
 * (publishDraftGraph.ts). Html-embedded images of these items are co-published with `item` like its own.
 */
export async function getRelatedDraftsCoPublishedWith(item: IItem<any>): Promise<IItem<any>[]> {
  const { getPublishDraftGraph } = await import('@/db/read/publishDraftGraph')
  const { drafts } = await getPublishDraftGraph(item)
  return drafts.map((d) => d.item)
}

async function prepareHtmlEmbeddedImagesOfItem(
  appDb: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  item: IItem<any>,
  publishPolicy: HtmlEmbeddedDataUriPolicy | undefined,
  deferred: Set<string>,
): Promise<void> {
  await deleteCoPublishRowsForParent(appDb, item.seedLocalId)

  for (const p of item.properties) {
    const def = p.propertyDef
    if (!def || normalizeDataTypeLocal(def.dataType) !== ModelPropertyDataTypes.Html) continue

    const policy = resolveEffectiveHtmlEmbeddedDataUriPolicy(def, publishPolicy)
    if (policy !== 'materialize') continue

    const snap = p.getService().getSnapshot()
    const ctx = 'context' in snap ? snap.context : null
    const htmlSeedLocalId = typeof (ctx as any)?.propertyValue === 'string' ? (ctx as any).propertyValue : ''
    const refResolved = (ctx as any)?.refResolvedValue as string | undefined
    if (!htmlSeedLocalId?.trim() || !refResolved) continue

    const filePath = `${BaseFileManager.getFilesPath('html')}/${refResolved}`
    const exists = await BaseFileManager.pathExists(filePath)
    if (!exists) continue

    let html: string
    try {
      html = await BaseFileManager.readFileAsString(filePath)
    } catch {
      const buf = await BaseFileManager.readFileAsBuffer(filePath)
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
        html = buf.toString('utf-8')
      } else if (typeof Blob !== 'undefined' && buf instanceof Blob) {
        html = await buf.text()
      } else if (buf instanceof ArrayBuffer) {
        html = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      } else {
        const v = buf as ArrayBufferView
        html = new TextDecoder('utf-8', { fatal: false }).decode(
          new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
        )
      }
    }

    let extracted: HtmlEmbeddedExtractEntry[]
    try {
      extracted = await extractDataUriImagesFromHtml(html)
    } catch (e) {
      if (e instanceof HtmlEmbeddedDataUriLimitError) throw e
      throw e
    }
    if (extracted.length === 0) continue

    deferred.add(htmlSeedLocalId.trim())

    for (const ent of extracted) {
      const { seedLocalId: imageSeedLocalId } = await createImageItemFromDataUri(ent.dataUri)
      const now = Date.now()
      await appDb.insert(htmlEmbeddedImageCoPublish).values({
        parentSeedLocalId: item.seedLocalId,
        htmlSeedLocalId: htmlSeedLocalId.trim(),
        imageSeedLocalId,
        stableKey: ent.stableKey,
        createdAt: now,
      }).onConflictDoNothing()
    }
  }
}

function normalizeDataTypeLocal(dt: string | undefined): string {
  if (!dt) return ''
  return dt.charAt(0).toUpperCase() + dt.slice(1).toLowerCase()
}

export type UploadedTx = { txId: string; seedLocalId?: string; versionLocalId?: string }

/**
 * After phase-1 uploads, rewrite Html files on disk: data URI → Arweave gateway URL.
 */
export async function rewriteHtmlEmbeddedImagesOnDisk(
  parentSeedLocalId: string,
  uploadedTransactions: UploadedTx[],
): Promise<void> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return

  const parentItem = await Item.find({ seedLocalId: parentSeedLocalId })
  if (!parentItem) return

  const txByImageSeed = new Map<string, string>()
  for (const u of uploadedTransactions) {
    if (u.seedLocalId && u.txId) {
      txByImageSeed.set(u.seedLocalId.trim(), u.txId.trim())
    }
  }

  // The parent's Html and that of the draft items published with it (see prepareHtmlEmbeddedImagesForPublish).
  for (const item of [parentItem, ...(await getRelatedDraftsCoPublishedWith(parentItem))]) {
    await rewriteHtmlEmbeddedImagesOfItem(appDb, item, txByImageSeed)
  }
}

async function rewriteHtmlEmbeddedImagesOfItem(
  appDb: NonNullable<ReturnType<typeof BaseDb.getAppDb>>,
  parentItem: IItem<any>,
  txByImageSeed: Map<string, string>,
): Promise<void> {
  const rows = await appDb
    .select()
    .from(htmlEmbeddedImageCoPublish)
    .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, parentItem.seedLocalId))

  if (rows.length === 0) return

  const htmlSeedIds = new Set(
    rows.map((r: (typeof rows)[number]) => String(r.htmlSeedLocalId).trim()),
  )

  const refByHtmlSeed = new Map<string, string>()
  if (parentItem) {
    for (const p of parentItem.properties) {
      const def = p.propertyDef
      if (!def || normalizeDataTypeLocal(def.dataType) !== ModelPropertyDataTypes.Html) continue
      const snap = p.getService().getSnapshot()
      const ctx = 'context' in snap ? snap.context : null
      const pv = typeof (ctx as any)?.propertyValue === 'string' ? (ctx as any).propertyValue.trim() : ''
      const refResolved = (ctx as any)?.refResolvedValue as string | undefined
      if (pv && refResolved) refByHtmlSeed.set(pv, refResolved)
    }
  }

  for (const htmlSeedLocalId of htmlSeedIds) {
    const refResolved = refByHtmlSeed.get(String(htmlSeedLocalId))
    if (!refResolved) continue
    const filePath = `${BaseFileManager.getFilesPath('html')}/${refResolved}`
    if (!(await BaseFileManager.pathExists(filePath))) continue

    const html = await BaseFileManager.readFileAsString(filePath)

    const replacements = new Map<string, string>()
    for (const r of rows) {
      if (String(r.htmlSeedLocalId).trim() !== htmlSeedLocalId) continue
      const txId = txByImageSeed.get(r.imageSeedLocalId.trim())
      if (!txId) continue
      const dataUri = await findDataUriForStableKey(html, r.stableKey)
      if (dataUri) replacements.set(dataUri, getArweaveUrlForTransaction(txId))
    }

    if (replacements.size === 0) continue

    const newHtml = replaceDataUrisInParsedHtml(html, replacements)
    try {
      await BaseFileManager.saveFile(filePath, newHtml)
    } catch {
      const fs = await BaseFileManager.getFs()
      fs.writeFileSync(filePath, newHtml)
    }

    if (parentItem) {
      for (const p of parentItem.properties) {
        const snap = p.getService().getSnapshot()
        const ctx = 'context' in snap ? snap.context : null
        const pv = typeof (ctx as any)?.propertyValue === 'string' ? (ctx as any).propertyValue.trim() : ''
        if (pv === htmlSeedLocalId) {
          p.getService().send({
            type: 'updateContext',
            renderValue: newHtml,
          })
        }
      }
    }
  }
}

async function findDataUriForStableKey(html: string, stableKey: string): Promise<string | undefined> {
  const entries = await extractDataUriImagesFromHtml(html)
  const hit = entries.find((e) => e.stableKey === stableKey)
  return hit?.dataUri
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
