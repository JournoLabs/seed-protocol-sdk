import { sha256, sha512 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

/** Checksum algorithms every bag carries a manifest for, in the order the manifests are written. */
export const BAG_ALGORITHMS = ['sha256', 'sha512'] as const
export type BagAlgorithm = (typeof BAG_ALGORITHMS)[number]

/** Lowercase hex digest of `bytes`. @noble/hashes rather than WebCrypto, so it also runs outside secure contexts. */
export const digestHex = (algorithm: BagAlgorithm, bytes: Uint8Array): string =>
  bytesToHex(algorithm === 'sha256' ? sha256(bytes) : sha512(bytes))

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const utf8 = (text: string): Uint8Array => encoder.encode(text)

/** `bytes` as UTF-8 text, or undefined when they are not valid UTF-8. */
export const fromUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return decoder.decode(bytes)
  } catch {
    return undefined
  }
}
