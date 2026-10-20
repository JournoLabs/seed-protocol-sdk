/** UTF-8 string to 0x-prefixed bytes32 hex (right-padded with zeros). */
export function encodeBytes32String(value: string): string {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length > 32) {
    throw new Error(`encodeBytes32String: value exceeds 32 bytes (${bytes.length})`)
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex.padEnd(64, '0')}`
}
