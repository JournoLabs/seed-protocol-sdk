/**
 * Serialized form part for IPC to main process (avoids CORS by proxying uploads).
 */
export type UploadFormPart = {
  name: string
  value: string
  encoding?: 'base64'
  filename?: string
}

/** Chunk size for base64 encoding; spreading large arrays blows the call stack. */
const BASE64_CHUNK_SIZE = 8192

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + BASE64_CHUNK_SIZE, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

/**
 * Convert FormData to a serializable array for IPC. Blobs are base64-encoded.
 */
export async function formDataToSerializableParts(
  formData: FormData
): Promise<UploadFormPart[]> {
  const parts: UploadFormPart[] = []
  for (const [name, value] of formData.entries()) {
    const entry = value as string | Blob
    if (typeof entry === 'object' && entry !== null && 'arrayBuffer' in entry) {
      const buf = await entry.arrayBuffer()
      const base64 = arrayBufferToBase64(buf)
      const file = entry as File
      parts.push({
        name,
        value: base64,
        encoding: 'base64',
        filename: file.name || undefined,
      })
    } else {
      parts.push({ name, value: String(value) })
    }
  }
  return parts
}

/** Result from upload POST (status 0 = network/proxy error). */
export type PostUploadResult = {
  status: number
  body: unknown
  error?: string
  message?: string
}

/** Build a user-facing message when the upload API returns a non-2xx status. */
export function uploadServerErrorMessage(
  status: number,
  body: unknown,
  transactionKeys?: string | null
): string {
  const parts: string[] = ['Upload server returned ', String(status)]
  const msg =
    body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null
  if (msg) parts.push(`: ${msg}`)
  else if (transactionKeys) parts.push(` (${transactionKeys})`)
  return parts.join('')
}

/** Map technical network error messages to a short, user-facing message. */
export function uploadNetworkErrorMessage(technicalMessage?: string | null): string {
  if (!technicalMessage) {
    return 'Upload server unavailable. Please try again or check your connection.'
  }
  const t = technicalMessage.toLowerCase()
  if (/other side closed|econnreset|socket hang up|connection closed/i.test(t)) {
    return 'Upload server closed the connection. It may be busy or the request may be too large—try again.'
  }
  if (/etimedout|timeout/i.test(t)) {
    return 'Upload request timed out. Please try again.'
  }
  if (/enotfound|getaddrinfo|dns/i.test(t)) {
    return 'Upload server could not be reached. Check the upload URL and your network.'
  }
  return 'Upload failed. Please try again or check the upload server.'
}

/**
 * POST to the upload API. Uses main-process proxy in Electron to avoid CORS;
 * falls back to fetch when not in Electron (e.g. browser tests).
 */
export async function postUploadArweaveStart(
  url: string,
  formData: FormData,
  uploadApiBaseUrl: string
): Promise<PostUploadResult> {
  const api = typeof window !== 'undefined' ? (window as Window & { Main?: { uploadArweaveStart?: (url: string, parts: UploadFormPart[]) => Promise<PostUploadResult> } }).Main : undefined
  if (api?.uploadArweaveStart) {
    const parts = await formDataToSerializableParts(formData)
    return api.uploadArweaveStart(url, parts)
  }
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

/**
 * POST to Arweave bundler for instant uploads. Same FormData format as upload API.
 * Uses main-process proxy in Electron to avoid CORS.
 */
export async function postUploadBundler(
  url: string,
  formData: FormData
): Promise<PostUploadResult> {
  const api = typeof window !== 'undefined' ? (window as Window & { Main?: { uploadArweaveStart?: (url: string, parts: UploadFormPart[]) => Promise<PostUploadResult> } }).Main : undefined
  if (api?.uploadArweaveStart) {
    const parts = await formDataToSerializableParts(formData)
    return api.uploadArweaveStart(url, parts)
  }
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}
