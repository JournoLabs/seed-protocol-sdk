import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/** EIP-55 checksum for a 20-byte hex address (with or without 0x prefix). */
export function checksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '')
  if (addr.length !== 40 || !/^[0-9a-f]+$/.test(addr)) {
    return address
  }
  const hash = bytesToHex(keccak_256(utf8ToBytes(addr)))
  let result = '0x'
  for (let i = 0; i < 40; i++) {
    result += parseInt(hash[i]!, 16) >= 8 ? addr[i]!.toUpperCase() : addr[i]!
  }
  return result
}

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
