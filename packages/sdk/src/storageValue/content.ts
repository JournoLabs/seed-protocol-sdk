import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getExtensionForMimeType, normalizeMimeType, sniffMimeType } from '@/helpers/mimeTypes'
import { storageFileNameForNewSeed } from '@/helpers/storageFileName'

/** The storage values that are seeds of their own (ADR 0019 "Storage values"). */
export type StorageKind = 'image' | 'file' | 'html'

/** Folder of each kind's files under the files root. */
export const STORAGE_SUBDIR: Record<StorageKind, 'images' | 'files' | 'html'> = {
  image: 'images',
  file: 'files',
  html: 'html',
}

/** What an assigned value becomes before it is written: content, or a file already in the folder. */
export type StorageContent =
  | { kind: 'bytes'; data: ArrayBuffer; mimeType?: string; sourceName?: string }
  | { kind: 'text'; data: string; mimeType?: string }
  | { kind: 'existing'; fileName: string }

/** A `data:` URL's bytes and MIME type (any parameters, base64 or percent-encoded); undefined for other strings. */
export function decodeDataUrl(value: string): { bytes: ArrayBuffer; mimeType?: string } | undefined {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(value)
  if (!match) return undefined
  const [, params, isBase64, payload] = match
  const bytes = isBase64
    ? Uint8Array.from(atob(payload.replace(/\s/g, '')), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload))
  return { bytes: toArrayBuffer(bytes), mimeType: normalizeMimeType(params) }
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** `cdn.example.com/a.png`: a host with a dot-separated name and a path, but no scheme. */
const SCHEMELESS_URL_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?\/\S*$/i
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** A file of this name already in the kind's folder (an empty name would be the folder itself). */
async function isExistingFileName(kind: StorageKind, value: string): Promise<boolean> {
  if (value.trim() === '' || /[\\/]/.test(value) || value.length >= 256) return false
  return BaseFileManager.pathExists(BaseFileManager.getFilesPath(STORAGE_SUBDIR[kind], value))
}

async function fetchContent(url: string, sourceName?: string): Promise<StorageContent> {
  const response = await fetch(url)
  const mimeType = normalizeMimeType(response.headers.get('Content-Type'))
  return { kind: 'bytes', data: await response.arrayBuffer(), mimeType, sourceName }
}

/** Raw base64 of an image: decoded only when the bytes have an image signature. */
function decodeBase64Image(value: string): StorageContent | undefined {
  if (value.length % 4 !== 0 || !BASE64_RE.test(value)) return undefined
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  } catch {
    return undefined
  }
  const mimeType = sniffMimeType(bytes)
  return mimeType?.startsWith('image/') ? { kind: 'bytes', data: toArrayBuffer(bytes), mimeType } : undefined
}

/**
 * What a value assigned to an Image, File or Html property is:
 *
 * - Html: its text.
 * - a File or Blob: its bytes, type and (File) name.
 * - a `data:` URL: its decoded bytes.
 * - an `http(s):` or `blob:` URL: fetched. A File keeps the URL's file name.
 * - the name of a file already in the kind's folder: a reference to it.
 * - Image only: `host.tld/path` is fetched over https, and raw base64 with an image signature is
 *   decoded. Any other string throws.
 * - File only: any other string is the file's text.
 */
export async function stageStorageContent(kind: StorageKind, value: unknown): Promise<StorageContent> {
  if (kind === 'html') {
    const text = typeof value === 'string' ? value : String(value ?? '')
    if (!text) throw new Error('No HTML content found')
    return { kind: 'text', data: text, mimeType: 'text/html' }
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    return { kind: 'bytes', data: await value.arrayBuffer(), mimeType: normalizeMimeType(value.type), sourceName: value.name }
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { kind: 'bytes', data: await value.arrayBuffer(), mimeType: normalizeMimeType(value.type) }
  }
  if (typeof value !== 'string') throw new Error('No file data found')

  const dataUrl = decodeDataUrl(value)
  if (dataUrl) return { kind: 'bytes', data: dataUrl.bytes, mimeType: dataUrl.mimeType }
  if (/^(https?:\/\/|blob:)/i.test(value)) {
    const sourceName =
      kind === 'file' && !value.startsWith('blob:') ? new URL(value).pathname.split('/').pop() || undefined : undefined
    return fetchContent(value, sourceName)
  }
  // Before the URL test: a name like "photo.png" in the folder is a reference, not a host
  if (await isExistingFileName(kind, value)) return { kind: 'existing', fileName: value }
  if (kind === 'file') return { kind: 'text', data: value }

  if (SCHEMELESS_URL_RE.test(value)) return fetchContent(`https://${value}`)
  const base64 = decodeBase64Image(value.trim())
  if (base64) return base64
  throw new Error('No file data found')
}

/** The MIME type of staged content: its declared type, else (bytes) its signature. */
export function storageContentMimeType(content: StorageContent): string | undefined {
  if (content.kind === 'existing') return undefined
  if (content.mimeType) return content.mimeType
  return content.kind === 'bytes' ? sniffMimeType(new Uint8Array(content.data)) : undefined
}

/**
 * Name of a new storage seed's file: `<id>.html` for Html; for an Image or File, the source's own
 * name after the id (`<id>-photo.png`, see storageFileNameForNewSeed), else the id with the
 * extension of its MIME type. A reference keeps the referenced file's name.
 */
export function storageFileName(kind: StorageKind, seedLocalId: string, content: StorageContent): string {
  if (content.kind === 'existing') return content.fileName
  if (kind === 'html') return `${seedLocalId}.html`
  if (content.kind === 'bytes' && content.sourceName) return storageFileNameForNewSeed(seedLocalId, content.sourceName)
  const extension = getExtensionForMimeType(storageContentMimeType(content))
  return extension ? `${seedLocalId}.${extension}` : seedLocalId
}
