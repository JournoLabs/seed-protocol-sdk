/**
 * The encryption identity: one random 32-byte secret from which the X-Wing recipient key and the
 * X25519 tag key are derived, and the recovery key, derived from a 24-word phrase. SPEC.md
 * "Identity" is the normative description.
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { generateMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { EnvelopeError, hkdf } from './envelope'
import { generateRecipientKeyPair, type RecipientKeyPair } from './recipient'

export const IDENTITY_SECRET_LENGTH = 32

const encoder = new TextEncoder()
const EMPTY = new Uint8Array(0)

export interface EncryptionIdentity {
  /** `0x` and 64 hex digits: SHA-256 over the label, the X-Wing public key and the X25519 public key. */
  keyId: string
  /** The 32 random bytes everything else derives from. The keystore manifest wraps exactly this. */
  secret: Uint8Array
  /** Version file keys are wrapped to `recipient.publicKey`. */
  recipient: RecipientKeyPair
  /** Static X25519 key for blinded tags (Phase 3). */
  tagKey: { secretKey: Uint8Array; publicKey: Uint8Array }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The identity derived from `secret`. Throws BAD_KEYSTORE when it isn't 32 bytes. */
export async function encryptionIdentityFromSecret(secret: Uint8Array): Promise<EncryptionIdentity> {
  if (secret.length !== IDENTITY_SECRET_LENGTH) {
    throw new EnvelopeError('BAD_KEYSTORE', `Identity secret must be ${IDENTITY_SECRET_LENGTH} bytes`)
  }
  const xwingSeed = await hkdf(secret, EMPTY, encoder.encode('seed-private/v1/identity/mlkem768x25519'), 32)
  const tagSecret = await hkdf(secret, EMPTY, encoder.encode('seed-private/v1/identity/x25519'), 32)
  const recipient = generateRecipientKeyPair(xwingSeed)
  const tagKey = { secretKey: tagSecret, publicKey: x25519.getPublicKey(tagSecret) }
  const label = encoder.encode('seed-private/v1/key-id')
  const idInput = new Uint8Array(label.length + 1 + recipient.publicKey.length + tagKey.publicKey.length)
  idInput.set(label, 0)
  idInput.set(recipient.publicKey, label.length + 1)
  idInput.set(tagKey.publicKey, label.length + 1 + recipient.publicKey.length)
  const keyId = `0x${toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', idInput)))}`
  return { keyId, secret: new Uint8Array(secret), recipient, tagKey }
}

/** A new identity from fresh random bytes. */
export function createEncryptionIdentity(): Promise<EncryptionIdentity> {
  return encryptionIdentityFromSecret(crypto.getRandomValues(new Uint8Array(IDENTITY_SECRET_LENGTH)))
}

/** 24 English BIP39 words encoding 32 random bytes. Show it to the user once; it isn't stored. */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256)
}

function normalizePhrase(phrase: string): string {
  return phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ')
}

/**
 * The recovery key pair for a phrase. Case, extra spaces and line breaks are ignored. Throws
 * BAD_RECOVERY_PHRASE for anything but 24 known words with a valid checksum.
 */
export async function recoveryKeyFromPhrase(phrase: string): Promise<RecipientKeyPair> {
  const words = normalizePhrase(phrase)
  let entropy: Uint8Array
  try {
    entropy = mnemonicToEntropy(words, wordlist)
  } catch {
    throw new EnvelopeError('BAD_RECOVERY_PHRASE', 'Recovery phrase has an unknown word or a bad checksum')
  }
  if (entropy.length !== 32) throw new EnvelopeError('BAD_RECOVERY_PHRASE', 'Recovery phrase must be 24 words')
  const seed = await hkdf(entropy, EMPTY, encoder.encode('seed-private/v1/recovery/mlkem768x25519'), 32)
  return generateRecipientKeyPair(seed)
}
