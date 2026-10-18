/**
 * File extension <-> MIME type, shared by the upload side (`getPublishUploads.ts`, which sets the
 * `Content-Type` tag) and the download worker (`browser/workers/filesDownload.ts`, which picks the
 * extension of a file saved under `files/`). The worker runs from a string and cannot import this
 * module, so {@link MIME_TO_EXTENSION} is injected into its source as JSON.
 */

/**
 * Lowercase extension (no dot) to MIME type. Includes the odd extensions the SDK itself produces:
 * `saveImage` names a file `<id>.<subtype>` (e.g. `.svg+xml`, `.x-icon`), so subtypes appear here too.
 */
export const EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
  // images
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  'svg+xml': 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  'x-icon': 'image/x-icon',
  'vnd.microsoft.icon': 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  // text / documents
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  json: 'application/json',
  txt: 'text/plain',
  plain: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xml: 'application/xml',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  epub: 'application/epub+zip',
  zip: 'application/zip',
  gz: 'application/gzip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  // audio
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
  // video
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  quicktime: 'video/quicktime',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/**
 * MIME type to the extension a downloaded file gets. One canonical extension per type (the
 * first one listed here wins over {@link EXTENSION_TO_MIME}'s aliases), plus a few common
 * non-canonical spellings a gateway may send.
 */
export const MIME_TO_EXTENSION: Readonly<Record<string, string>> = (() => {
  const preferred: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/tiff': 'tiff',
    'text/html': 'html',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/javascript': 'js',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/ogg': 'ogv',
  }
  const out: Record<string, string> = { ...preferred }
  for (const [ext, mime] of Object.entries(EXTENSION_TO_MIME)) {
    if (!(mime in out)) out[mime] = ext
  }
  // Non-canonical names some servers use for the same formats.
  Object.assign(out, {
    'audio/mp3': 'mp3',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/vnd.wave': 'wav',
    'audio/x-m4a': 'm4a',
    'audio/x-flac': 'flac',
    'application/x-zip-compressed': 'zip',
    'image/vnd.microsoft.icon': 'ico',
  })
  return out
})()

/**
 * Content types that say nothing about the content. A Blob carrying one of these is treated as
 * untyped.
 */
export const GENERIC_MIME_TYPES: readonly string[] = [
  '',
  'application/octet-stream',
  'binary/octet-stream',
]

/** Lowercase `type/subtype` without parameters; `undefined` when empty or generic. */
export const normalizeMimeType = (mimeType: string | null | undefined): string | undefined => {
  const t = (mimeType ?? '').split(';')[0]!.trim().toLowerCase()
  if (!t || GENERIC_MIME_TYPES.includes(t) || !t.includes('/')) return undefined
  return t
}

/** MIME type for a path or file name by its extension, if it has a known one. */
export const getMimeTypeFromPath = (filePathOrName: string): string | undefined => {
  const name = filePathOrName.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return undefined
  return EXTENSION_TO_MIME[name.slice(dot + 1).toLowerCase()]
}

/** Extension (no dot) for a MIME type, if it has a well-known one. */
export const getExtensionForMimeType = (mimeType: string | null | undefined): string | undefined => {
  const t = normalizeMimeType(mimeType)
  return t ? MIME_TO_EXTENSION[t] : undefined
}

/**
 * MIME type from the leading bytes, for formats with an unambiguous signature. Used when a local
 * file has no (known) extension, e.g. a file seed named after its id.
 */
export const sniffMimeType = (bytes: Uint8Array): string | undefined => {
  const at = (offset: number, ...sig: number[]) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b)
  const ascii = (offset: number, s: string) =>
    at(offset, ...Array.from(s).map((c) => c.charCodeAt(0)))

  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav'
  if (ascii(0, 'RIFF') && ascii(8, 'AVI ')) return 'video/x-msvideo'
  if (ascii(0, 'BM') && bytes.length > 14) return 'image/bmp'
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return 'image/tiff'
  if (ascii(0, '%PDF-')) return 'application/pdf'
  if (ascii(0, 'OggS')) return 'audio/ogg'
  if (ascii(0, 'fLaC')) return 'audio/flac'
  if (ascii(0, 'ID3')) return 'audio/mpeg'
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm'
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(...Array.from(bytes.slice(8, 12)))
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (['heic', 'heix', 'heif', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
    if (brand === 'qt  ') return 'video/quicktime'
    if (brand === 'M4A ') return 'audio/mp4'
    return 'video/mp4'
  }
  return undefined
}

/**
 * Best MIME type for upload bytes: the source's own type (a Blob/File `type`) when it is specific,
 * then the file name's extension, then the bytes' signature.
 */
export const resolveUploadMimeType = (params: {
  sourceType?: string | null
  fileName?: string | null
  bytes?: Uint8Array
}): string | undefined =>
  normalizeMimeType(params.sourceType) ??
  (params.fileName ? getMimeTypeFromPath(params.fileName) : undefined) ??
  (params.bytes ? sniffMimeType(params.bytes) : undefined)
