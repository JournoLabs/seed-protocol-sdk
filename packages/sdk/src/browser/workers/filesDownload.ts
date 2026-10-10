export default `(
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

const isBinary = (arrayBuffer: ArrayBuffer): boolean => {
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

/**
 * GET /raw/{id} from each gateway in order. `networkFailedEverywhere` is true only when no gateway
 * answered at all; a non-2xx (e.g. not yet propagated) is not a reason to exclude the transaction.
 */
const fetchRaw = async (
  baseUrls: string[],
  transactionId: string,
): Promise<{ arrayBuffer?: ArrayBuffer; networkFailedEverywhere: boolean }> => {
  let answered = false
  for (const base of baseUrls) {
    try {
      const response = await fetch(`${base}/raw/${transactionId}`)
      answered = true
      if (!response.ok) continue
      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > 0) {
        return { arrayBuffer, networkFailedEverywhere: false }
      }
    } catch (error) {
      /* next gateway */
    }
  }
  return { networkFailedEverywhere: !answered }
}

const downloadFiles = async ({
  transactionIds,
  arweaveHost,
  arweaveBaseUrls,
  filesRoot = '/files',
}: {
  transactionIds: string[],
  arweaveHost: string,
  arweaveBaseUrls?: string[],
  filesRoot?: string,
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
    const { arrayBuffer, networkFailedEverywhere } = await fetchRaw(baseUrls, transactionId)

    if (!arrayBuffer) {
      if (networkFailedEverywhere) {
        globalThis.postMessage({
          message: 'excludeTransaction',
          transactionId,
        })
      }
      continue
    }

    let dataString
    const isBinaryData = isBinary(arrayBuffer)

    if (!isBinaryData) {
      const decoder = new TextDecoder('utf-8')
      const text = decoder.decode(arrayBuffer)
      dataString = text
    }

    if (dataString && dataString.startsWith('===FILE_SEPARATOR===')) {
      const dataStringParts = dataString
        .split('===FILE_SEPARATOR===')
        .slice(1)

      if (dataStringParts.length % 2 !== 0) {
        throw new Error('Input array must have an even number of elements.')
      }

      for (let i = 0; i < dataStringParts.length; i += 2) {
        const contentType = dataStringParts[i]
        const content = dataStringParts[i + 1]
        const encoder = new TextEncoder()
        if (contentType === 'html') {
          const fileName = `${transactionId}.html`
          const buffer = encoder.encode(content)
          await saveBufferToOPFS(getFilesPath(filesRoot, 'html', fileName), buffer)
        }
        if (contentType === 'json') {
          const fileName = `${transactionId}.json`
          const buffer = encoder.encode(content)
          await saveBufferToOPFS(getFilesPath(filesRoot, 'json', fileName), buffer)
        }
      }

      continue
    }

    if (!dataString && arrayBuffer) {
      await saveBufferToOPFS(
        getFilesPath(filesRoot, 'images', transactionId),
        new Uint8Array(arrayBuffer),
      )
      continue
    }

    if (!dataString) {
      continue
    }

    let contentType = identifyString(dataString)

    if (
      contentType !== 'json' &&
      contentType !== 'base64' &&
      contentType !== 'html'
    ) {
      const possibleImageType = getDataTypeFromString(dataString)
      if (!possibleImageType) {
        continue
      }

      contentType = possibleImageType
    }

    if (contentType === 'url') {
      const url = dataString as string

      let buffer: ArrayBuffer | undefined

      try {
        const response = await fetch(url)
        if (!response.ok) {
          continue
        }

        buffer = await response.arrayBuffer()

      } catch(error) {
        globalThis.postMessage({
          message: 'excludeTransaction',
          transactionId,
        })
        continue
      }

      const bufferUint8Array = new Uint8Array(buffer)

      // Extract the file extension from the URL
      const extensionMatch = url.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)
      if (!extensionMatch) {
        throw new Error(
          'Unable to determine the file extension from the URL.',
        )
      }
      const fileExtension = extensionMatch[0] // e.g., ".jpg"

      // Set the file name (you can customize this)
      // const fileNameFromUrl = `${transactionId}${fileExtension}`

      await saveBufferToOPFS(
        getFilesPath(filesRoot, 'images', transactionId),
        bufferUint8Array,
      )

      continue
    }

    const mimeType = getMimeType(dataString as string)
    let fileExtension = mimeType

    if (fileExtension && fileExtension?.startsWith('image')) {
      fileExtension = fileExtension.replace('image/', '')
    }

    let fileName = transactionId

    if (contentType === 'base64') {
      if (fileExtension) {
        fileName += `.${fileExtension}`
      }

      // Remove the Base64 header if it exists (e.g., "data:image/png;base64,")
      const base64Data = dataString.split(',').pop() || ''

      // Decode the Base64 string to binary
      const binaryString = atob(base64Data)
      const length = binaryString.length
      const binaryData = new Uint8Array(length)

      for (let i = 0; i < length; i++) {
        binaryData[i] = binaryString.charCodeAt(i)
      }

      await saveBufferToOPFS(getFilesPath(filesRoot, 'images', fileName), binaryData)

    }

    if (contentType === 'html') {
      fileName += '.html'
      const encoder = new TextEncoder()
      const buffer = encoder.encode(dataString)
      await saveBufferToOPFS(getFilesPath(filesRoot, 'html', fileName), buffer)
    }

    if (contentType === 'json') {
      fileName += '.json'
      const encoder = new TextEncoder()
      const buffer = encoder.encode(dataString)
      await saveBufferToOPFS(getFilesPath(filesRoot, 'json', fileName), buffer)
    }
  }
}

onmessage = async (e) => {
  const { debug, filesRoot } = e.data
  if (!debug) {
    console.log = () => {}
  }
  await downloadFiles({ ...e.data, filesRoot });
  globalThis.postMessage({
    message: 'filesDownload onmessage done',
    done: true,
  })
  
}
}.toString()
}
)()`