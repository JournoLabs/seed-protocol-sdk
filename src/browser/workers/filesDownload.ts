
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
  const fileHandle = await fileHandleAsync.createSyncAccessHandle();
  // Write the buffer to the file
  fileHandle.write(buffer);
  fileHandle.flush();
  fileHandle.close();
}

const downloadFiles = async ({
  transactionIds,
  arweaveHost,
}: {
  transactionIds: string[],
  arweaveHost: string,
}) => {

  let arrayBuffer: ArrayBuffer | undefined

  for (const transactionId of transactionIds) {
    try {
      const response = await fetch(`https://${arweaveHost}/raw/${transactionId}`);

      arrayBuffer = await response.arrayBuffer();
    } catch(error) {
      console.log(`[filesDownload] transaction ${transactionId} data not found`, error)
      globalThis.postMessage({
        message: 'excludeTransaction',
        transactionId,
      })
      continue
    }

    let dataString
    const isBinaryData = isBinary(arrayBuffer)

    if (!isBinaryData) {
      const decoder = new TextDecoder('utf-8')
      const text = decoder.decode(arrayBuffer)
      dataString = text
    }

    if (!dataString && !arrayBuffer) {
      console.log(
        `[filesDownload] transaction ${transactionId} data not found`,
      )
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
          saveBufferToOPFS(`/files/html/${fileName}`, buffer)
        }
        if (contentType === 'json') {
          const fileName = `${transactionId}.json`
          const buffer = encoder.encode(content)
          saveBufferToOPFS(`/files/json/${fileName}`, buffer)
        }
      }

      continue
    }

    if (!dataString && arrayBuffer) {
      saveBufferToOPFS(
        `/files/images/${transactionId}`,
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
        console.log(
          `[filesDownload] transaction ${transactionId} data not in expected format: ${possibleImageType}`,
        )
        continue
      }

      contentType = possibleImageType
    }

    if (contentType === 'url') {
      const url = dataString as string

      let buffer: ArrayBuffer | undefined

      try {
        const response = await fetch(url)
  
        buffer = await response.arrayBuffer()

      } catch(error) {
        console.log(`[filesDownload] transaction ${transactionId} value was url: ${dataString} but failed to fetch`, error)
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
        `/files/images/${transactionId}`,
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

      await saveBufferToOPFS(`/files/images/${fileName}`, binaryData)

    }

    if (contentType === 'html') {
      fileName += '.html'
      const encoder = new TextEncoder()
      const buffer = encoder.encode(dataString)
      await saveBufferToOPFS(`/files/html/${fileName}`, buffer)
    }

    if (contentType === 'json') {
      fileName += '.json'
      const encoder = new TextEncoder()
      const buffer = encoder.encode(dataString)
      await saveBufferToOPFS(`/files/json/${fileName}`, buffer)
    }
  }
}

onmessage = async (e) => {
  console.log({
    message: 'filesDownload onmessage',
    data: e.data,
  })
  await downloadFiles(e.data);
  globalThis.postMessage({
    message: 'filesDownload onmessage done',
    done: true,
  })
  
}
}.toString()
}
)()`