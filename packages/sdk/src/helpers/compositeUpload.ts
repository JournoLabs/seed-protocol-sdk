/**
 * Composite uploads: several ItemStorage files of one item in a single Arweave transaction.
 *
 * Producer: `getPublishUploads.ts` (`processUploadPropertyData`), for an item with a
 * `storageTransactionId` property and ItemStorage properties (e.g. a Post's `html` and `json`).
 * Consumer: the download worker (`browser/workers/filesDownload.ts`), which keeps its own copy of
 * {@link decodeCompositeUpload} because it runs from a string; a test keeps the two in step.
 *
 * Format (unchanged for text children, so composites already on Arweave still read):
 *
 *   ===FILE_SEPARATOR===<name>===FILE_SEPARATOR===<utf-8 text>   (repeated per child)
 *
 * A child that is not valid UTF-8 text (or whose text contains the separator) is written as
 * base64 under the name `<name>;base64`. Composites written before this suffix existed converted
 * every child to text, which corrupted binary children; those bytes cannot be recovered.
 */
export const COMPOSITE_SEPARATOR = '===FILE_SEPARATOR==='
export const COMPOSITE_BASE64_SUFFIX = ';base64'

export type CompositeChild = { name: string; bytes: Uint8Array }

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const base64ToBytes = (base64: string): Uint8Array | undefined => {
  try {
    const binary = atob(base64.replace(/\s/g, ''))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return undefined
  }
}

/** The child's text when it can travel as text: valid UTF-8, no NUL bytes, no separator. */
const childAsText = (bytes: Uint8Array): string | undefined => {
  if (bytes.includes(0)) return undefined
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
  return text.includes(COMPOSITE_SEPARATOR) ? undefined : text
}

export const encodeCompositeUpload = (children: CompositeChild[]): Uint8Array => {
  let composite = ''
  for (const { name, bytes } of children) {
    const text = childAsText(bytes)
    composite +=
      text !== undefined
        ? `${COMPOSITE_SEPARATOR}${name}${COMPOSITE_SEPARATOR}${text}`
        : `${COMPOSITE_SEPARATOR}${name}${COMPOSITE_BASE64_SUFFIX}${COMPOSITE_SEPARATOR}${bytesToBase64(bytes)}`
  }
  return new TextEncoder().encode(composite)
}

const SEPARATOR_BYTES = new TextEncoder().encode(COMPOSITE_SEPARATOR)

/** True when `bytes` start with the composite separator (checked on bytes, before any text heuristics). */
export const isCompositeUpload = (bytes: Uint8Array): boolean =>
  bytes.length >= SEPARATOR_BYTES.length && SEPARATOR_BYTES.every((b, i) => bytes[i] === b)

/** Children of a composite, or `undefined` when `bytes` are not a well-formed composite. */
export const decodeCompositeUpload = (bytes: Uint8Array): CompositeChild[] | undefined => {
  if (!isCompositeUpload(bytes)) return undefined
  const parts = new TextDecoder('utf-8').decode(bytes).split(COMPOSITE_SEPARATOR).slice(1)
  if (parts.length % 2 !== 0) return undefined
  const encoder = new TextEncoder()
  const children: CompositeChild[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const rawName = parts[i]!
    const content = parts[i + 1]!
    if (rawName.endsWith(COMPOSITE_BASE64_SUFFIX)) {
      const decoded = base64ToBytes(content)
      if (!decoded) return undefined
      children.push({ name: rawName.slice(0, -COMPOSITE_BASE64_SUFFIX.length), bytes: decoded })
    } else {
      children.push({ name: rawName, bytes: encoder.encode(content) })
    }
  }
  return children
}
