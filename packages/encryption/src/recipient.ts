/**
 * The `mlkem768x25519` recipient stanza: the file key sealed with HPKE to an X-Wing public key.
 * The publisher's own wrap and the recovery wrap are both this stanza type, to different keys.
 * SPEC.md "Recipient stanzas" is the normative description.
 */

import { decodeBase64NoPad, encodeBase64NoPad } from './base64'
import { EnvelopeError, FILE_KEY_LENGTH, type EnvelopeHeader, type Stanza } from './envelope'
import {
  XWING_ENC_LENGTH,
  XWING_PUBLIC_KEY_LENGTH,
  XWING_SECRET_KEY_LENGTH,
  openBase,
  sealBase,
  xwingKeyPair,
} from './hpke'

export const XWING_STANZA_TYPE = 'mlkem768x25519'
const XWING_INFO = new TextEncoder().encode('seed-private/v1/mlkem768x25519')
const WRAPPED_KEY_LENGTH = FILE_KEY_LENGTH + 16

export { XWING_PUBLIC_KEY_LENGTH, XWING_SECRET_KEY_LENGTH }

export interface RecipientKeyPair {
  /** 32 bytes. Everything else is derived from it, so this is the only part to keep secret and store. */
  secretKey: Uint8Array
  /** 1216 bytes: the ML-KEM-768 encapsulation key, then the X25519 public key. */
  publicKey: Uint8Array
}

/** A new X-Wing key pair. Pass a 32-byte seed to derive the same pair again. */
export function generateRecipientKeyPair(seed?: Uint8Array): RecipientKeyPair {
  const s = seed ?? crypto.getRandomValues(new Uint8Array(XWING_SECRET_KEY_LENGTH))
  if (s.length !== XWING_SECRET_KEY_LENGTH) {
    throw new EnvelopeError('BAD_RECIPIENT_KEY', `Recipient seed must be ${XWING_SECRET_KEY_LENGTH} bytes`)
  }
  return xwingKeyPair(s)
}

/** Wrap with caller-chosen encapsulation randomness (64 bytes). Exported for test vectors only. */
export async function wrapFileKeyWithRandomness(fileKey: Uint8Array, publicKey: Uint8Array, randomness?: Uint8Array): Promise<Stanza> {
  if (fileKey.length !== FILE_KEY_LENGTH) throw new EnvelopeError('BAD_FILE_KEY', `File key must be ${FILE_KEY_LENGTH} bytes`)
  if (publicKey.length !== XWING_PUBLIC_KEY_LENGTH) {
    throw new EnvelopeError('BAD_RECIPIENT_KEY', `Recipient public key must be ${XWING_PUBLIC_KEY_LENGTH} bytes`)
  }
  const { enc, ciphertext } = await sealBase(publicKey, XWING_INFO, new Uint8Array(0), fileKey, randomness)
  return { type: XWING_STANZA_TYPE, args: [encodeBase64NoPad(enc)], body: ciphertext }
}

/** A stanza that gives the holder of `publicKey`'s secret key the file key. */
export function wrapFileKey(fileKey: Uint8Array, publicKey: Uint8Array): Promise<Stanza> {
  return wrapFileKeyWithRandomness(fileKey, publicKey)
}

/**
 * The file key, or null when the stanza is another type or was wrapped to a different key.
 * Throws BAD_HEADER for an `mlkem768x25519` stanza that is malformed.
 */
export async function unwrapFileKey(stanza: Stanza, secretKey: Uint8Array): Promise<Uint8Array | null> {
  if (stanza.type !== XWING_STANZA_TYPE) return null
  if (secretKey.length !== XWING_SECRET_KEY_LENGTH) {
    throw new EnvelopeError('BAD_RECIPIENT_KEY', `Recipient secret key must be ${XWING_SECRET_KEY_LENGTH} bytes`)
  }
  const enc = stanza.args.length === 1 ? decodeBase64NoPad(stanza.args[0]!) : null
  if (!enc || enc.length !== XWING_ENC_LENGTH) {
    throw new EnvelopeError('BAD_HEADER', `${XWING_STANZA_TYPE} stanza needs one argument: ${XWING_ENC_LENGTH} bytes of base64`)
  }
  if (stanza.body.length !== WRAPPED_KEY_LENGTH) {
    throw new EnvelopeError('BAD_HEADER', `${XWING_STANZA_TYPE} stanza body must be ${WRAPPED_KEY_LENGTH} bytes`)
  }
  return openBase(enc, secretKey, XWING_INFO, new Uint8Array(0), stanza.body)
}

/**
 * An `unwrap` callback for `decryptEnvelope` that tries every `mlkem768x25519` stanza against
 * each secret key, in order, and returns the first file key that opens.
 */
export function unwrapWithSecretKeys(secretKeys: Uint8Array[]): (header: EnvelopeHeader) => Promise<Uint8Array | null> {
  return async (header) => {
    for (const stanza of header.stanzas) {
      for (const key of secretKeys) {
        const fileKey = await unwrapFileKey(stanza, key)
        if (fileKey) return fileKey
      }
    }
    return null
  }
}
