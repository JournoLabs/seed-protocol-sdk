import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

/** keccak-256 hex (no 0x), matching js-sha3 `keccak256`. */
export function keccak256Hex(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? utf8ToBytes(data) : data
  return bytesToHex(keccak_256(bytes))
}
