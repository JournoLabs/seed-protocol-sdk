/**
 * Blob URLs the SDK mints for property values (File and Image display URLs). Only these are revoked
 * by `ItemProperty`: a blob URL the app passed in as a value stays the app's to revoke.
 */
const minted = new Set<string>()

export const createSessionObjectUrl = (blob: Blob): string => {
  const url = URL.createObjectURL(blob)
  minted.add(url)
  return url
}

export const isSessionObjectUrl = (value: unknown): value is string =>
  typeof value === 'string' && minted.has(value)

export const revokeSessionObjectUrl = (url: string): void => {
  if (!minted.delete(url)) return
  URL.revokeObjectURL(url)
}
