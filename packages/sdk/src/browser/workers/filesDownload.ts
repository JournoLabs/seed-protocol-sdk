import { MIME_TO_EXTENSION } from '@/helpers/mimeTypes'

/**
 * Injected at the top of the worker source below (the worker runs from a string and cannot import):
 * the same MIME -> extension map the upload side uses, see `helpers/mimeTypes.ts`. A free global,
 * so bundlers never rename references to it.
 */
declare const SEED_MIME_TO_EXTENSION: Record<string, string>

export default `const SEED_MIME_TO_EXTENSION = ${JSON.stringify(MIME_TO_EXTENSION)};
(
  ${
    function () {

const identifyString = (str: string) => {
  try {
    JSON.parse(str)
    return 'json'
  } catch (e) {
    // Not JSON
  }

  if (!str) {
    return
  }

  if (str.trim().startsWith('<') && str.trim().endsWith('>')) {
    return 'html'
  }

  // Simple markdown checks (very naive)
  if (/^#{1,6}\s|^-{3,}|\*{3,}|^-{1,2}\s|\*\s/.test(str)) {
    return 'markdown'
  }

  if (/^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(str)) {
    return 'base64'
  }

  // Default to plain text if unsure
  return 'text'
}

const getMimeType = (base64: string) => {
  if (!base64) {
    return null
  }
  const result = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*,/)

  if (result && result.length > 1) {
    return result[1]
  } else {
    return null // MIME type could not be determined
  }
}

const getDataTypeFromString = (
  data: string,
): 'imageBase64' | 'base64' | 'url' | null => {
  const nonImageBase64Regex =
    /^(?!data:image\/(?:jpeg|png|gif|bmp|webp);base64,)[A-Za-z0-9+/=]+$/

  if (nonImageBase64Regex.test(data)) {
    return 'base64'
  }

  // Regular expression for base64 (simple version, checking for base64 format)
  const imageBase64Regex = /^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/

  if (imageBase64Regex.test(data)) {
    return 'imageBase64'
  }

  // Regular expression for URL (simple version, checking for common URL format)
  const urlRegex =
    /^(http:\/\/www\.|https:\/\/www\.|http:\/\/|https:\/\/)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/

  if (urlRegex.test(data)) {
    return 'url'
  }

  return null
}

const isBinary = (arrayBuffer: ArrayBuffer | Uint8Array): boolean => {
  const view = new Uint8Array(arrayBuffer);

  let nonTextCount = 0;
  const threshold = 0.2; // Adjust as needed (e.g., 20% non-text implies binary)

  for (let i = 0; i < view.length; i++) {
      const byte = view[i];

      // ASCII printable characters (32-126) and common whitespace (9, 10, 13)
      if (
          (byte >= 32 && byte <= 126) || // Printable ASCII
          byte === 9 || byte === 10 || byte === 13 // Tab, LF, CR
      ) {
          continue;
      }

      nonTextCount++;
      if (nonTextCount / view.length > threshold) {
          return true; // More than threshold are non-text bytes
      }
  }

  return false; // Fewer than threshold are non-text bytes
}

const saveBufferToOPFS = async (filePath: string, buffer: Uint8Array): Promise<void> => {
  // Access the OPFS root directory
  const rootHandle = await navigator.storage.getDirectory();

  // Split the filePath into directory segments and file name
  const segments = filePath.split('/').filter(Boolean);
  const fileName = segments.pop(); // Extract the file name
  if (!fileName) {
      throw new Error('Invalid file path: No file name provided.');
  }

  // Traverse or create directories as needed
  let currentDirHandle = rootHandle;
  for (const segment of segments) {
      currentDirHandle = await currentDirHandle.getDirectoryHandle(segment, { create: true });
  }

  // Create or open the file in OPFS
  const fileHandleAsync = await currentDirHandle.getFileHandle(fileName, { create: true });

  const write = async () => {
    const fileHandle = await fileHandleAsync.createSyncAccessHandle();
    try {
      // Drop any previous, longer contents before writing from the start
      fileHandle.truncate(0);
      fileHandle.write(buffer, { at: 0 });
      fileHandle.flush();
    } finally {
      // A leaked handle keeps the file locked for the worker's lifetime
      fileHandle.close();
    }
  }

  // A sync access handle is exclusive: a download of the same file in another tab or worker would
  // make createSyncAccessHandle throw, so writers of one path take turns.
  if (navigator.locks) {
    await navigator.locks.request(`seed:opfs-write:${filePath}`, write);
  } else {
    await write();
  }

  // Written past ZenFS: the page refreshes its cache for this path and tells other tabs.
  globalThis.postMessage({ message: 'fileSaved', filePath });
}

const getFilesPath = (filesRoot: string, ...parts: string[]) => {
  const root = filesRoot.replace(/\/$/, '')
  return [root, ...parts].filter(Boolean).join('/').replace(/\/+/g, '/')
}

/** Per-gateway limit for one `/raw/{id}` request, body included. */
const RAW_FETCH_TIMEOUT_MS = 60_000

const errorInfo = (error: unknown): { name: string; message: string } => {
  const e = (error ?? {}) as { name?: unknown; message?: unknown }
  return {
    name: typeof e.name === 'string' && e.name ? e.name : 'Error',
    message: typeof e.message === 'string' ? e.message : String(error),
  }
}

const toBaseUrl = (hostOrUrl: string): string => {
  const h = (hostOrUrl || '').trim().replace(/\/$/, '')
  if (!h) return ''
  if (h.startsWith('http://') || h.startsWith('https://')) return h
  const protocol =
    h.startsWith('127.0.0.1') || h.startsWith('localhost') || h.includes(':1984')
      ? 'http'
      : 'https'
  return `${protocol}://${h}`
}

const toHex = (buffer: ArrayBuffer): string => {
  const view = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0')
  return hex
}

/** Verification requests waiting for the page's answer, by request id. */
const pendingVerifications = new Map<number, (ok: boolean) => void>()
let lastVerificationId = 0

/**
 * Ask the page whether `bytes` match a Content-SHA-256 tag. The page runs `contentSha256TagMatches`,
 * which also accepts the SHA3-256 digests older SDKs wrote under that tag (no SHA3 in WebCrypto, and
 * this worker cannot import a hash library). The bytes are copied, not transferred.
 */
const verifyOnPage = (transactionId: string, bytes: ArrayBuffer, expected: string): Promise<boolean> =>
  new Promise((resolve) => {
    const requestId = ++lastVerificationId
    pendingVerifications.set(requestId, resolve)
    globalThis.postMessage({ message: 'verifyContent', requestId, transactionId, expected, bytes })
  })

/**
 * True when the downloaded bytes match the upload's Content-SHA-256 tag. SHA-256 is checked here
 * with WebCrypto when available (secure contexts); anything else goes to the page.
 */
const contentMatchesTag = async (transactionId: string, bytes: ArrayBuffer, expected: string): Promise<boolean> => {
  const want = expected.trim().toLowerCase()
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle
    if (subtle && toHex(await subtle.digest('SHA-256', bytes)) === want) return true
  } catch (error) {
    /* fall back to the page */
  }
  return verifyOnPage(transactionId, bytes, want)
}

/**
 * GET /raw/{id} from each gateway in order. `networkFailedEverywhere` is true only when no gateway
 * answered at all; a non-2xx (e.g. not yet propagated) is not a reason to exclude the transaction.
 * `contentType` is the response's Content-Type (gateways serve the upload's Content-Type tag).
 * With `expectedHash` (the upload's Content-SHA-256 tag), a body that does not match it is skipped
 * and the next gateway tried; `hashMismatch` says that happened and no gateway served matching bytes.
 */
const fetchRaw = async (
  baseUrls: string[],
  transactionId: string,
  expectedHash?: string,
): Promise<{
  arrayBuffer?: ArrayBuffer
  contentType?: string
  networkFailedEverywhere: boolean
  verified?: boolean
  hashMismatch?: boolean
}> => {
  let answered = false
  let hashMismatch = false
  for (const base of baseUrls) {
    let arrayBuffer: ArrayBuffer | undefined
    let contentType = ''
    // A hung gateway must not stall the batch: abort the request (body included) after a while.
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined
    const timer = controller ? setTimeout(() => controller.abort(), RAW_FETCH_TIMEOUT_MS) : undefined
    try {
      const response = await fetch(`${base}/raw/${transactionId}`, controller ? { signal: controller.signal } : undefined)
      answered = true
      if (!response.ok) continue
      arrayBuffer = await response.arrayBuffer()
      contentType = (response.headers?.get('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase()
    } catch (error) {
      /* next gateway */
      continue
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (!arrayBuffer || arrayBuffer.byteLength === 0) continue
    if (expectedHash) {
      if (!(await contentMatchesTag(transactionId, arrayBuffer, expectedHash))) {
        // E.g. a gateway's error page served with 200: don't trust it, try the next gateway.
        hashMismatch = true
        continue
      }
      return { arrayBuffer, contentType, networkFailedEverywhere: false, verified: true }
    }
    return { arrayBuffer, contentType, networkFailedEverywhere: false }
  }
  return { networkFailedEverywhere: !answered, hashMismatch }
}

/**
 * Downloaded bytes on their way to OPFS. The one place a read-side transform (e.g. decrypting a
 * future private upload) would go for downloads: this worker runs from a string, so it cannot
 * import the main thread's `transformArweaveContent`; keys or config would arrive in the message.
 * Identity for now.
 */
const transformDownloadedContent = async (
  bytes: Uint8Array,
  _context: { transactionId: string; contentType: string },
): Promise<Uint8Array> => bytes

/** True when the bytes start with the signature of an image format the SDK stores in `images/`. */
const hasImageSignature = (bytes: Uint8Array): boolean => {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b)
  const ascii = (offset: number, s: string) =>
    at(offset, ...Array.from(s).map((c) => c.charCodeAt(0)))
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return true // PNG
  if (at(0, 0xff, 0xd8, 0xff)) return true // JPEG
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return true
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return true
  if (ascii(0, 'BM')) return true // BMP
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return true // ICO
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return true // TIFF
  if (ascii(4, 'ftyp')) {
    // ISO-BMFF images (AVIF / HEIC); ftyp is also MP4, so check the brand
    const brand = String.fromCharCode(...Array.from(bytes.slice(8, 12)))
    return ['avif', 'avis', 'heic', 'heix', 'heif', 'mif1', 'msf1'].includes(brand)
  }
  return false
}

/**
 * Content-Types that say nothing about the content: these are sniffed instead. `text/plain` is
 * here because some gateways send it for anything textual.
 */
const GENERIC_CONTENT_TYPES = ['', 'application/octet-stream', 'binary/octet-stream', 'text/plain']

/** Where a declared Content-Type goes; undefined means sniff the bytes. */
const directoryForContentType = (contentType: string): 'images' | 'html' | 'json' | 'files' | undefined => {
  if (GENERIC_CONTENT_TYPES.indexOf(contentType) !== -1) return undefined
  if (contentType.startsWith('image/')) return 'images'
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') return 'html'
  if (contentType === 'application/json' || contentType.endsWith('+json')) return 'json'
  return 'files'
}

/** Shared with the upload side (`helpers/mimeTypes.ts`), injected into this worker's source. */
const FILE_EXTENSIONS: Record<string, string> = SEED_MIME_TO_EXTENSION

/** `files/{txId}` plus an extension when the Content-Type has a well-known one. */
const fileNameForFiles = (transactionId: string, contentType: string): string => {
  const ext = FILE_EXTENSIONS[contentType]
  return ext ? `${transactionId}.${ext}` : transactionId
}

const decodeBase64 = (base64: string): Uint8Array | undefined => {
  try {
    const binaryString = atob(base64)
    const binaryData = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      binaryData[i] = binaryString.charCodeAt(i)
    }
    return binaryData
  } catch (error) {
    return undefined
  }
}

/**
 * Composite format: a copy of `helpers/compositeUpload.ts` (this worker cannot import; a test
 * decodes the SDK encoder's output through this worker). Children are
 * `===FILE_SEPARATOR===<name>===FILE_SEPARATOR===<text>`; a binary child's name ends in `;base64`
 * and its content is base64.
 */
const COMPOSITE_SEPARATOR = '===FILE_SEPARATOR==='
const COMPOSITE_BASE64_SUFFIX = ';base64'

const startsWithCompositeSeparator = (bytes: Uint8Array): boolean => {
  if (bytes.length < COMPOSITE_SEPARATOR.length) return false
  for (let i = 0; i < COMPOSITE_SEPARATOR.length; i++) {
    if (bytes[i] !== COMPOSITE_SEPARATOR.charCodeAt(i)) return false
  }
  return true
}

const decodeComposite = (bytes: Uint8Array): { name: string; bytes: Uint8Array }[] | undefined => {
  const parts = new TextDecoder('utf-8').decode(bytes).split(COMPOSITE_SEPARATOR).slice(1)
  if (parts.length % 2 !== 0) return undefined
  const encoder = new TextEncoder()
  const children: { name: string; bytes: Uint8Array }[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const rawName = parts[i]
    const content = parts[i + 1]
    if (rawName.endsWith(COMPOSITE_BASE64_SUFFIX)) {
      const decoded = decodeBase64(content.replace(/\s/g, ''))
      if (!decoded) return undefined
      children.push({ name: rawName.slice(0, -COMPOSITE_BASE64_SUFFIX.length), bytes: decoded })
    } else {
      children.push({ name: rawName, bytes: encoder.encode(content) })
    }
  }
  return children
}

/**
 * A composite child's path from the page, relative to the files root. Only plain relative paths
 * are taken: nothing absolute, no `.` / `..` segments, no backslashes.
 */
const safeRelativePath = (path: unknown): string | undefined => {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.indexOf('\\') !== -1) return undefined
  const segments = path.split('/')
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return undefined
  }
  return path
}

const downloadFiles = async ({
  transactionIds,
  arweaveHost,
  arweaveBaseUrls,
  filesRoot = '/files',
  expectedContentHashes,
  compositeChildPaths,
}: {
  transactionIds: string[],
  arweaveHost: string,
  arweaveBaseUrls?: string[],
  filesRoot?: string,
  /** Content-SHA-256 tag values by transaction id; downloads with one are verified before saving. */
  expectedContentHashes?: Record<string, string>,
  /**
   * Where each child of a composite goes, by transaction id then child (property) name: a path
   * relative to the files root, the one the SDK reads that ItemStorage property from
   * (`<storage dir>/<txId><extension>`). Children without one fall back to the html / json layout.
   */
  compositeChildPaths?: Record<string, Record<string, string>>,
}) => {

  // Preferred / resolved gateways first, then the configured host; deduped.
  const baseUrls: string[] = []
  for (const candidate of (arweaveBaseUrls || []).concat([arweaveHost])) {
    const base = toBaseUrl(candidate)
    if (base && baseUrls.indexOf(base) === -1) {
      baseUrls.push(base)
    }
  }

  for (const transactionId of transactionIds) {
    // One bad file (failed OPFS write, quota, malformed content) must not stall or abort the batch.
    try {
      await downloadFile(
        transactionId,
        baseUrls,
        filesRoot,
        expectedContentHashes?.[transactionId],
        compositeChildPaths?.[transactionId],
      )
    } catch (error) {
      globalThis.postMessage({ message: 'fileError', transactionId, error: errorInfo(error) })
    }
    // Liveness signal for the page's inactivity watchdog.
    globalThis.postMessage({ message: 'fileProcessed', transactionId })
  }
}

const downloadFile = async (
  transactionId: string,
  baseUrls: string[],
  filesRoot: string,
  expectedHash: string | undefined,
  childPaths: Record<string, string> | undefined,
) => {
  const encoder = new TextEncoder()
  const fetched = await fetchRaw(baseUrls, transactionId, expectedHash)

  if (fetched.verified) {
    globalThis.postMessage({ message: 'contentVerified', transactionId })
  }

  if (!fetched.arrayBuffer) {
    if (fetched.hashMismatch) {
      // Nothing saved: the bytes are not what was uploaded. Not excluded, a later run may get them.
      globalThis.postMessage({ message: 'contentHashMismatch', transactionId })
    } else if (fetched.networkFailedEverywhere) {
      globalThis.postMessage({
        message: 'excludeTransaction',
        transactionId,
      })
    }
    return
  }

  const contentType = fetched.contentType || ''
  const bytes = await transformDownloadedContent(new Uint8Array(fetched.arrayBuffer), {
    transactionId,
    contentType,
  })

  const saveToFiles = (data: Uint8Array) =>
    saveBufferToOPFS(
      getFilesPath(filesRoot, 'files', fileNameForFiles(transactionId, contentType)),
      data,
    )

  // Composite upload (several ItemStorage files in one transaction, uploaded as
  // application/octet-stream). Detected on the bytes: a composite of mostly non-ASCII text (e.g.
  // CJK html) would fail the isBinary heuristic below.
  if (startsWithCompositeSeparator(bytes)) {
    const children = decodeComposite(bytes)
    if (!children) {
      // Not a composite after all: keep the bytes rather than fail the whole download.
      await saveToFiles(bytes)
      return
    }
    for (const child of children) {
      // Children are routed by property name: to the path the page gave for it (the model's
      // ItemStorage directory and extension), else the html / json layout older SDKs assumed.
      const routed = childPaths && Object.prototype.hasOwnProperty.call(childPaths, child.name)
        ? safeRelativePath(childPaths[child.name])
        : undefined
      if (routed) {
        await saveBufferToOPFS(getFilesPath(filesRoot, routed), child.bytes)
      } else if (child.name === 'html') {
        await saveBufferToOPFS(getFilesPath(filesRoot, 'html', `${transactionId}.html`), child.bytes)
      } else if (child.name === 'json') {
        await saveBufferToOPFS(getFilesPath(filesRoot, 'json', `${transactionId}.json`), child.bytes)
      } else {
        // No local item knows this child's property yet; a later download (after sync) places it.
        globalThis.postMessage({ message: 'compositeChildUnrouted', transactionId, name: child.name })
      }
    }
    return
  }

  let dataString: string | undefined
  if (!isBinary(bytes)) {
    dataString = new TextDecoder('utf-8').decode(bytes)
  }

  // The upload said what it is (Content-Type tag, served as the response header).
  const declaredDir = directoryForContentType(contentType)
  const isLegacyDataUri = !!dataString && dataString.startsWith('data:')
  if (declaredDir && !isLegacyDataUri) {
    if (declaredDir === 'images') {
      await saveBufferToOPFS(getFilesPath(filesRoot, 'images', transactionId), bytes)
    } else if (declaredDir === 'html') {
      await saveBufferToOPFS(getFilesPath(filesRoot, 'html', `${transactionId}.html`), bytes)
    } else if (declaredDir === 'json') {
      await saveBufferToOPFS(getFilesPath(filesRoot, 'json', `${transactionId}.json`), bytes)
    } else {
      await saveToFiles(bytes)
    }
    return
  }

  // No useful Content-Type: sniff. Binary is an image only when it has an image signature.
  if (!dataString) {
    if (hasImageSignature(bytes)) {
      await saveBufferToOPFS(getFilesPath(filesRoot, 'images', transactionId), bytes)
    } else {
      await saveToFiles(bytes)
    }
    return
  }

  let textType = identifyString(dataString)

  if (
    textType !== 'json' &&
    textType !== 'base64' &&
    textType !== 'html'
  ) {
    const possibleImageType = getDataTypeFromString(dataString)
    if (!possibleImageType) {
      // Plain text / markdown / anything else textual.
      await saveToFiles(bytes)
      return
    }

    textType = possibleImageType
  }

  if (textType === 'url') {
    const url = dataString as string

    // Legacy: an upload whose content is the URL of an image.
    if (!/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(url)) {
      await saveToFiles(bytes)
      return
    }

    let buffer: ArrayBuffer | undefined

    try {
      const response = await fetch(url)
      if (!response.ok) {
        return
      }

      buffer = await response.arrayBuffer()

    } catch(error) {
      globalThis.postMessage({
        message: 'excludeTransaction',
        transactionId,
      })
      return
    }

    await saveBufferToOPFS(
      getFilesPath(filesRoot, 'images', transactionId),
      new Uint8Array(buffer),
    )

    return
  }

  let fileName = transactionId

  if (textType === 'base64') {
    const mimeType = getMimeType(dataString as string)
    const isDataUri = dataString.startsWith('data:')
    // Remove the Base64 header if it exists (e.g., "data:image/png;base64,")
    const binaryData = decodeBase64(dataString.split(',').pop() || '')

    // A data:image URI, or bare base64 that decodes to an image. Anything else is kept as text.
    const isImage =
      !!binaryData &&
      ((isDataUri && !!mimeType && mimeType.startsWith('image/')) || hasImageSignature(binaryData))
    if (!binaryData || !isImage) {
      await saveToFiles(bytes)
      return
    }

    const fileExtension = mimeType && mimeType.startsWith('image/') ? mimeType.replace('image/', '') : mimeType
    if (fileExtension) {
      fileName += `.${fileExtension}`
    }

    await saveBufferToOPFS(getFilesPath(filesRoot, 'images', fileName), binaryData)
  }

  if (textType === 'html') {
    fileName += '.html'
    await saveBufferToOPFS(getFilesPath(filesRoot, 'html', fileName), encoder.encode(dataString))
  }

  if (textType === 'json') {
    fileName += '.json'
    await saveBufferToOPFS(getFilesPath(filesRoot, 'json', fileName), encoder.encode(dataString))
  }
}

onmessage = async (e) => {
  const data = (e && e.data) || {}
  if (data.message === 'verifyContentResult') {
    const resolve = pendingVerifications.get(data.requestId)
    pendingVerifications.delete(data.requestId)
    if (resolve) resolve(!!data.ok)
    return
  }
  const { debug, filesRoot } = data
  if (!debug) {
    console.log = () => {}
  }
  try {
    await downloadFiles({ ...data, filesRoot })
  } catch (error) {
    // Anything not caught per file: tell the page instead of leaving it waiting for `done`.
    globalThis.postMessage({ message: 'filesDownload failed', error: errorInfo(error) })
    return
  }
  globalThis.postMessage({
    message: 'filesDownload onmessage done',
    done: true,
  })
}
}.toString()
}
)()`