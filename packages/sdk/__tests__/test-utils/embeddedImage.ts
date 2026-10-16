/**
 * Image bytes and data URI the size of a real embedded image. A 1×1 PNG's data URI (~118 characters)
 * fits in a Text property's default 255-character limit, so tests using it can't catch code that
 * stores the data URI somewhere length-limited; this one is well over it.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export const EMBEDDED_IMAGE_BYTE_LENGTH = 4096

/** PNG signature followed by deterministic filler, `byteLength` bytes in all. */
export const embeddedImageBytes = (byteLength = EMBEDDED_IMAGE_BYTE_LENGTH): Uint8Array =>
  Uint8Array.from({ length: byteLength }, (_, i) => (i < PNG_SIGNATURE.length ? PNG_SIGNATURE[i]! : (i * 31) % 256))

export const embeddedImageDataUri = (bytes = embeddedImageBytes()): string =>
  `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
