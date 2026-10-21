import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { normalizeDataType } from '@/helpers/property'
import { getItemStorageSubdir, getStorageSubdirForDataType } from '@/helpers/storageDir'
import { ImageSize } from '@/helpers/constants'
import { STORAGE_SUBDIR, type StorageKind } from './content'
import { findFileInDir } from './findFile'

/** A property whose value is held in a file: a storage seed of its own, or the item's own file. */
export type StoredValueKind = StorageKind | 'itemStorage'

/** The row fields that say where a storage value's file is. */
export type StorageRef = {
  propertyValue?: string | null
  refResolvedValue?: string | null
  localStorageDir?: string | null
  refSeedType?: string | null
}

type StorageDef = { dataType?: string; refValueType?: string; storageType?: string } | null | undefined

/** Which kind of file holds a property's value, from its definition, else the row's `refSeedType`. */
export function storedValueKind(def: StorageDef, row?: { refSeedType?: string | null }): StoredValueKind | undefined {
  if (def?.storageType === 'ItemStorage') return 'itemStorage'
  const dataType = normalizeDataType(def?.dataType)
  const refValueType = normalizeDataType(def?.refValueType)
  if (dataType === 'Image' || refValueType === 'Image' || row?.refSeedType === 'image') return 'image'
  if (dataType === 'File' || row?.refSeedType === 'file') return 'file'
  if (dataType === 'Html' || row?.refSeedType === 'html') return 'html'
  return undefined
}

/** Folder (relative to the files root, no slashes) of a storage value's file: the row's, else its kind's. */
export function storageSubdir(kind: StoredValueKind, localStorageDir?: string | null): string {
  if (kind === 'itemStorage') return getItemStorageSubdir(localStorageDir)
  return (localStorageDir ?? '').replace(/^\/+/, '').replace(/\/+$/, '') || STORAGE_SUBDIR[kind]
}

/**
 * Path of the file a storage seed's row names, for publish: `<folder>/<refResolvedValue>`, where the
 * folder is the row's `localStorageDir`, else the one for `dataType` (Image, File, Html, Json).
 */
export function storageUploadPath(params: {
  dataType: string | null | undefined
  refResolvedValue: string
  localStorageDir?: string | null
}): string {
  const dir =
    (params.localStorageDir ?? '').replace(/^\/+/, '').replace(/\/+$/, '') || getStorageSubdirForDataType(params.dataType)
  return BaseFileManager.getFilesPath(dir, params.refResolvedValue)
}

const ATTESTATION_UID_RE = /^0x[a-fA-F0-9]{64}$/

/**
 * The Arweave transaction id a storage seed's own row records (`storageTransactionId`; seeds
 * synced under the older schema name use `transactionId`).
 */
export async function storageSeedTransactionId(seed: { seedLocalId?: string | null; seedUid?: string | null }): Promise<string | undefined> {
  const { currentPropertyRow } = await import('@/db/read/currentPropertyRow')
  for (const propertyName of ['storageTransactionId', 'transactionId']) {
    const row = await currentPropertyRow(seed, { propertyName }, { overlay: false })
    const value = row?.propertyValue?.trim()
    if (value) return value
  }
  return undefined
}

/**
 * The file reference of a storage value, filling in what a synced row leaves out without writing it
 * back: an Image row that holds the image seed's uid but no file name points at that seed's
 * transaction id; an Html row with no file name is `html/<storage seed local id>.html`.
 */
export async function resolveStorageRef(kind: StoredValueKind, row: StorageRef): Promise<StorageRef> {
  const out = { ...row }
  if (kind === 'image' && !out.refResolvedValue && out.propertyValue && ATTESTATION_UID_RE.test(out.propertyValue)) {
    const txId = await storageSeedTransactionId({ seedUid: out.propertyValue })
    if (txId) {
      out.refResolvedValue = txId
      out.localStorageDir = out.localStorageDir ?? '/images'
    }
  }
  if (kind === 'html') {
    if (!out.refResolvedValue && out.propertyValue) {
      const { resolveHtmlStorageSeedLocalId } = await import('@/helpers/readHtmlBodyForStorageSeed')
      const localId = await resolveHtmlStorageSeedLocalId(out.propertyValue)
      if (localId) out.refResolvedValue = `${localId}.html`
    }
    if (out.refResolvedValue && !out.localStorageDir) out.localStorageDir = '/html'
  }
  if (kind === 'image' && out.refResolvedValue && !out.localStorageDir) out.localStorageDir = '/images'
  return out
}

export type StorageDisplayOptions = {
  /**
   * Fetch a file that isn't on disk: download an Image or File by its transaction id, read an Html
   * body through its storage seed's transaction id. Loads pass true; the per-snapshot display pass
   * doesn't.
   */
  fetch?: boolean
  /** Find a file by a name match when the exact name isn't there (downloads are named after the tx id). */
  scan?: boolean
  /** A pending ItemStorage value's staged file, read before the row's file. */
  stagedPath?: string
  /** How long to wait for an Html file that isn't there yet (OPFS writes land late). Default 5000 ms. */
  htmlWaitMs?: number
}

/**
 * What a storage value shows (`renderValue`): a session URL for an Image or File (blob: in
 * browsers, file:// in Node), the text for Html and ItemStorage. `filePath` is the file it came
 * from; `ref` the row's file reference with resolveStorageRef's gaps filled. `renderValue` is
 * undefined when no file was found.
 */
export async function resolveStorageDisplay(
  kind: StoredValueKind,
  row: StorageRef,
  options: StorageDisplayOptions = {},
): Promise<{ ref: StorageRef; filePath?: string; renderValue?: string }> {
  const ref = await resolveStorageRef(kind, row)
  const dir = storageSubdir(kind, ref.localStorageDir)
  const name = ref.refResolvedValue ?? undefined

  if (kind === 'itemStorage') {
    const staged = options.stagedPath
    const filePath =
      staged && (await BaseFileManager.pathExists(staged))
        ? staged
        : name
          ? BaseFileManager.getFilesPath(dir, name)
          : undefined
    if (!filePath || !(await BaseFileManager.pathExists(filePath))) return { ref }
    return { ref, filePath, renderValue: await BaseFileManager.readFileAsString(filePath) }
  }

  if (kind === 'html') {
    let renderValue: string | undefined
    let filePath: string | undefined
    if (name) {
      const exact = BaseFileManager.getFilesPath(dir, name)
      let exists = await BaseFileManager.pathExists(exact)
      if (!exists) {
        await BaseFileManager.waitForFileWithContent(exact, 100, options.htmlWaitMs ?? 5000).catch(() => {})
        exists = await BaseFileManager.pathExists(exact)
      }
      if (exists) {
        filePath = exact
        renderValue = await BaseFileManager.readFileAsString(exact)
      }
    }
    if (!renderValue && options.fetch && ref.propertyValue) {
      const { readHtmlBodyForStorageSeedPropertyValue } = await import('@/helpers/readHtmlBodyForStorageSeed')
      renderValue = await readHtmlBodyForStorageSeedPropertyValue(ref.propertyValue)
    }
    return { ref, filePath, renderValue }
  }

  if (!name) return { ref }
  const find = () =>
    options.scan || options.fetch
      ? findFileInDir(dir, [name])
      : BaseFileManager.pathExists(BaseFileManager.getFilesPath(dir, name)).then((exists) =>
          exists ? BaseFileManager.getFilesPath(dir, name) : undefined,
        )
  // ensureImageLocal also makes the smallest size variant when the original is already there
  if (kind === 'image' && options.fetch) {
    const { ensureImageLocal } = await import('@/helpers/ensureImageLocal')
    await ensureImageLocal({ transactionId: name, fileName: name, widths: [ImageSize.EXTRA_SMALL] })
  }
  let filePath = await find()
  if (!filePath && kind === 'file' && options.fetch) {
    const { downloadTransactionIdWithDedupe } = await import('@/events/files/download')
    await downloadTransactionIdWithDedupe(name)
    filePath = await find()
  }
  if (!filePath) return { ref }
  return { ref, filePath, renderValue: await BaseFileManager.getContentUrlFromPath(filePath) }
}
