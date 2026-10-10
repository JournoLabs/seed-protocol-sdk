import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

type HashInput = string | Uint8Array | ArrayBuffer

function toBytes(data: HashInput): Uint8Array {
  if (typeof data === 'string') return utf8ToBytes(data)
  if (data instanceof Uint8Array) return data
  return new Uint8Array(data)
}

export const getContentHash = async (
  data: HashInput
): Promise<string> => {
  return bytesToHex(sha3_256(toBytes(data)))
}

/**
 * Generate a deterministic ID from a seed string.
 * Same seed always produces the same id (first 10 hex chars of SHA3-256).
 * Used for schema/model/property IDs to prevent duplicates across runs.
 */
export const getDeterministicId = (seed: string): string => {
  return bytesToHex(sha3_256(utf8ToBytes(seed))).slice(0, 10)
}

/**
 * Returns a function that maps `suffix` to `getDeterministicId(prefix + suffix)`, hashing `prefix` only
 * once. Use it when deriving many ids from one long shared prefix (e.g. a whole serialized schema).
 */
export const getDeterministicIdsWithPrefix = (prefix: string): ((suffix: string) => string) => {
  const prefixHash = sha3_256.create().update(utf8ToBytes(prefix))
  return (suffix: string) => bytesToHex(prefixHash.clone().update(utf8ToBytes(suffix)).digest()).slice(0, 10)
}
