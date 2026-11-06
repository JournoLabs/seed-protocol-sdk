/**
 * Single-shot HPKE (RFC 9180) in base mode, for one suite: KEM MLKEM768-X25519 (X-Wing, `0x647a`),
 * KDF HKDF-SHA256 (`0x0001`), AEAD AES-256-GCM (`0x0002`). Only the first message of a context is
 * sealed or opened, so the nonce is the base nonce. The KEM comes from `@noble/post-quantum`; the
 * key schedule and AEAD use WebCrypto.
 */

import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js'

export const XWING_KEM_ID = 0x647a
const KDF_ID = 0x0001
const AEAD_ID = 0x0002
const NK = 32
const NN = 12
const NH = 32

export const XWING_PUBLIC_KEY_LENGTH = 1216
export const XWING_SECRET_KEY_LENGTH = 32
export const XWING_ENC_LENGTH = 1120
/** Randomness one encapsulation consumes: 32 bytes for ML-KEM, then 32 for the X25519 ephemeral. */
export const XWING_ENCAPSULATION_RANDOMNESS_LENGTH = 64

const encoder = new TextEncoder()

function u16(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([n >> 8, n & 0xff])
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const SUITE_ID = concat([encoder.encode('HPKE'), u16(XWING_KEM_ID), u16(KDF_ID), u16(AEAD_ID)])
const HPKE_V1 = encoder.encode('HPKE-v1')

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  // An empty HMAC key equals HashLen zero bytes; WebCrypto rejects zero-length keys.
  const raw = key.length === 0 ? new Uint8Array(NH) : new Uint8Array(key)
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array(data)))
}

function labeledExtract(salt: Uint8Array, label: string, ikm: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return hmac(salt, concat([HPKE_V1, SUITE_ID, encoder.encode(label), ikm]))
}

/** HKDF-Expand for L <= HashLen, which is all this suite needs. */
async function labeledExpand(prk: Uint8Array, label: string, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const labeledInfo = concat([u16(length), HPKE_V1, SUITE_ID, encoder.encode(label), info])
  const t1 = await hmac(prk, concat([labeledInfo, new Uint8Array([1])]))
  return t1.slice(0, length)
}

async function keySchedule(sharedSecret: Uint8Array, info: Uint8Array, usage: 'encrypt' | 'decrypt') {
  const empty = new Uint8Array(0)
  const pskIdHash = await labeledExtract(empty, 'psk_id_hash', empty)
  const infoHash = await labeledExtract(empty, 'info_hash', info)
  const context = concat([new Uint8Array([0x00]), pskIdHash, infoHash])
  const secret = await labeledExtract(sharedSecret, 'secret', empty)
  const key = await labeledExpand(secret, 'key', context, NK)
  const nonce = await labeledExpand(secret, 'base_nonce', context, NN)
  return { key: await crypto.subtle.importKey('raw', key, 'AES-GCM', false, [usage]), nonce }
}

export function xwingKeyPair(seed: Uint8Array): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const { secretKey, publicKey } = ml_kem768_x25519.keygen(seed)
  return { secretKey, publicKey }
}

/** RFC 9180 SealBase. `randomness` is for test vectors only; leave it out to use the CSPRNG. */
export async function sealBase(
  publicKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
  randomness?: Uint8Array,
): Promise<{ enc: Uint8Array; ciphertext: Uint8Array }> {
  const { sharedSecret, cipherText } = ml_kem768_x25519.encapsulate(publicKey, randomness)
  const { key, nonce } = await keySchedule(sharedSecret, info, 'encrypt')
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(aad) }, key, new Uint8Array(plaintext))
  return { enc: cipherText, ciphertext: new Uint8Array(sealed) }
}

/** RFC 9180 OpenBase. Returns null when the ciphertext doesn't authenticate under this key. */
export async function openBase(
  enc: Uint8Array,
  secretKey: Uint8Array,
  info: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  const sharedSecret = ml_kem768_x25519.decapsulate(enc, secretKey)
  const { key, nonce } = await keySchedule(sharedSecret, info, 'decrypt')
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(aad) }, key, new Uint8Array(ciphertext)),
    )
  } catch {
    return null
  }
}
