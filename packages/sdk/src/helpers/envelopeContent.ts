/**
 * Opening downloaded `seed-private/v1` envelopes (ADR 0033). The download worker keeps an envelope
 * whole at `encrypted/<txId>`; this tab opens it with the decryptor the app registered and writes the
 * plaintext where a plain download of the same content would have gone. The SDK holds no keys and
 * never imports the encryption package: `createEnvelopeDecryptor` from `@seedprotocol/encryption`
 * builds the decryptor from an unlocked identity.
 */

import debug from 'debug'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { decodeCompositeUpload } from '@/helpers/compositeUpload'
import { MIME_TO_EXTENSION } from '@/helpers/mimeTypes'

const logger = debug('seedSdk:helpers:envelopeContent')

/** Where the download worker keeps an envelope it couldn't open, by transaction id. */
export const ENCRYPTED_DOWNLOAD_DIR = 'encrypted'

/**
 * Opens an envelope: its plaintext and the content type recorded inside it, or null when this
 * device has no key for it. Throwing counts as null: the envelope stays as it is.
 */
export type EnvelopeDecryptor = (envelope: Uint8Array) => Promise<{ contentType: string; body: Uint8Array } | null>

let decryptor: EnvelopeDecryptor | undefined

/**
 * Registers the decryptor this tab opens downloaded envelopes with, or removes it. Envelopes already
 * downloaded are opened by {@link openEncryptedDownloads}; later downloads are opened as they land.
 */
export function setEnvelopeDecryptor(next: EnvelopeDecryptor | undefined): void {
  decryptor = next
}

export function hasEnvelopeDecryptor(): boolean {
  return decryptor !== undefined
}

/** Path of a transaction's kept envelope. */
export const encryptedDownloadPath = (transactionId: string): string =>
  BaseFileManager.getFilesPath(ENCRYPTED_DOWNLOAD_DIR, transactionId)

/** Whether this device holds `transactionId` only as an envelope it hasn't opened. */
export async function hasEncryptedDownload(transactionId: string | null | undefined): Promise<boolean> {
  if (!transactionId) return false
  return BaseFileManager.pathExists(encryptedDownloadPath(transactionId))
}

const startsWithComposite = (bytes: Uint8Array): boolean => {
  const separator = '===FILE_SEPARATOR==='
  if (bytes.length < separator.length) return false
  for (let i = 0; i < separator.length; i++) if (bytes[i] !== separator.charCodeAt(i)) return false
  return true
}

const isSafeRelativePath = (path: string | undefined): path is string =>
  !!path && !path.startsWith('/') && !path.includes('\\') && path.split('/').every((s) => !!s && s !== '.' && s !== '..')

/**
 * Where a decrypted transaction's plaintext goes, as paths relative to the files root: the layout
 * the download worker uses for plain downloads (`images/<tx>`, `html/<tx>.html`, `json/<tx>.json`,
 * `files/<tx>[.ext]`, and a composite's children at the paths its ItemStorage rows give). Routed by
 * the content type inside the envelope, since the upload itself was tagged octet-stream.
 */
export function plaintextDownloadFiles(
  transactionId: string,
  contentType: string,
  body: Uint8Array,
  childPaths?: Record<string, string>,
): { path: string; bytes: Uint8Array }[] {
  if (startsWithComposite(body)) {
    const children = decodeCompositeUpload(body)
    if (children) {
      const out: { path: string; bytes: Uint8Array }[] = []
      for (const child of children) {
        const routed = childPaths && Object.prototype.hasOwnProperty.call(childPaths, child.name) ? childPaths[child.name] : undefined
        if (isSafeRelativePath(routed)) out.push({ path: routed, bytes: child.bytes })
        else if (child.name === 'html') out.push({ path: `html/${transactionId}.html`, bytes: child.bytes })
        else if (child.name === 'json') out.push({ path: `json/${transactionId}.json`, bytes: child.bytes })
        else logger(`composite ${transactionId}: no local path for child "${child.name}"; not saved`)
      }
      return out
    }
  }
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  if (type.startsWith('image/')) return [{ path: `images/${transactionId}`, bytes: body }]
  if (type === 'text/html' || type === 'application/xhtml+xml') return [{ path: `html/${transactionId}.html`, bytes: body }]
  if (type === 'application/json' || type.endsWith('+json')) return [{ path: `json/${transactionId}.json`, bytes: body }]
  const ext = MIME_TO_EXTENSION[type]
  return [{ path: `files/${ext ? `${transactionId}.${ext}` : transactionId}`, bytes: body }]
}

/**
 * Opens the kept envelopes of `transactionIds` with the registered decryptor and writes their
 * plaintext, skipping any whose plaintext is already on disk. Returns the paths written; a
 * transaction this device has no key for is left as it is. The envelope is kept either way.
 */
export async function openEncryptedDownloads(
  transactionIds: string[],
  compositeChildPaths?: Record<string, Record<string, string>>,
): Promise<{ written: string[]; opened: string[]; stillEncrypted: string[] }> {
  const written: string[] = []
  const opened: string[] = []
  const stillEncrypted: string[] = []
  for (const transactionId of transactionIds) {
    const path = encryptedDownloadPath(transactionId)
    if (!(await BaseFileManager.pathExists(path))) continue
    // Already opened: opening again would overwrite what's there, maybe a newer local edit.
    if (await hasPlaintext(transactionId, compositeChildPaths?.[transactionId])) continue
    let plaintext: Awaited<ReturnType<EnvelopeDecryptor>> = null
    if (decryptor) {
      try {
        const envelope = new Uint8Array(await (await BaseFileManager.openBlob(path)).arrayBuffer())
        plaintext = await decryptor(envelope)
      } catch (error) {
        logger(`could not open ${transactionId}`, error)
      }
    }
    if (!plaintext) {
      stillEncrypted.push(transactionId)
      continue
    }
    for (const file of plaintextDownloadFiles(transactionId, plaintext.contentType, plaintext.body, compositeChildPaths?.[transactionId])) {
      const target = BaseFileManager.getFilesPath(file.path)
      await BaseFileManager.saveFile(target, new Blob([file.bytes as BlobPart]))
      written.push(target)
    }
    opened.push(transactionId)
  }
  return { written, opened, stillEncrypted }
}

/**
 * Opens every envelope this device has downloaded but not opened, for an app that unlocks its
 * identity after downloads ran: register the decryptor with {@link setEnvelopeDecryptor}, then call
 * this. Properties showing `valueStatus: 'encrypted'` read their files again as they land.
 */
export async function openAllEncryptedDownloads(): Promise<{ opened: string[]; stillEncrypted: string[] }> {
  const transactionIds = await BaseFileManager.listFiles(ENCRYPTED_DOWNLOAD_DIR)
  if (transactionIds.length === 0) return { opened: [], stillEncrypted: [] }
  const { getCompositeChildPaths } = await import('@/db/read/getCompositeChildPaths')
  const childPaths = await getCompositeChildPaths(transactionIds)
  const { written, opened, stillEncrypted } = await openEncryptedDownloads(transactionIds, childPaths)
  if (written.length) {
    const { notifyFilesWrittenOutsideCache } = await import('@/helpers/tabEvents')
    await notifyFilesWrittenOutsideCache(written)
  }
  return { opened, stillEncrypted }
}

/**
 * Whether `transactionId`'s plaintext is already on disk: a composite's child files (opening it
 * again would overwrite a newer local edit), else a plain download under the worker's layout.
 */
async function hasPlaintext(transactionId: string, childPaths: Record<string, string> | undefined): Promise<boolean> {
  const children = Object.values(childPaths ?? {})
  if (children.length > 0) {
    for (const path of children) if (!(await BaseFileManager.pathExists(BaseFileManager.getFilesPath(path)))) return false
    return true
  }
  for (const path of [`images/${transactionId}`, `html/${transactionId}.html`, `json/${transactionId}.json`, `files/${transactionId}`]) {
    if (await BaseFileManager.pathExists(BaseFileManager.getFilesPath(path))) return true
  }
  return (await BaseFileManager.listFiles('files')).some((name) => name.startsWith(`${transactionId}.`))
}
