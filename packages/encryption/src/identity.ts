/**
 * The encryption identity: one random 32-byte secret from which the X-Wing recipient key, the
 * X25519 tag key and the Ed25519 binding key are derived, and the recovery key, derived from a
 * 24-word phrase. SPEC.md "Identity" and "Key binding" are the normative description.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { generateMnemonic, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { EnvelopeError, hkdf } from './envelope'
import { generateRecipientKeyPair, type RecipientKeyPair } from './recipient'

export const IDENTITY_SECRET_LENGTH = 32

const encoder = new TextEncoder()
const EMPTY = new Uint8Array(0)

export interface EncryptionIdentity {
  /**
   * `0x` and 64 hex digits: SHA-256 over the label, the X-Wing public key, the X25519 public key
   * and the Ed25519 binding public key.
   */
  keyId: string
  /** The 32 random bytes everything else derives from. The keystore manifest wraps exactly this. */
  secret: Uint8Array
  /** Version file keys are wrapped to `recipient.publicKey`. */
  recipient: RecipientKeyPair
  /** Static X25519 key for blinded tags (Phase 3). */
  tagKey: { secretKey: Uint8Array; publicKey: Uint8Array }
  /** Ed25519 key that signs the key binding an account registers ({@link signKeyBinding}). */
  bindingKey: { secretKey: Uint8Array; publicKey: Uint8Array }
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
  const bindingSecret = await hkdf(secret, EMPTY, encoder.encode('seed-private/v1/identity/ed25519'), 32)
  const tagKey = { secretKey: tagSecret, publicKey: x25519.getPublicKey(tagSecret) }
  const bindingKey = { secretKey: bindingSecret, publicKey: ed25519.getPublicKey(bindingSecret) }
  const keyId = await encryptionKeyId(recipient.publicKey, tagKey.publicKey, bindingKey.publicKey)
  return { keyId, secret: new Uint8Array(secret), recipient, tagKey, bindingKey }
}

/** The key id of three public keys, as SPEC.md "Identity" defines it. */
export async function encryptionKeyId(recipientPublicKey: Uint8Array, tagPublicKey: Uint8Array, bindingPublicKey: Uint8Array): Promise<string> {
  const label = encoder.encode('seed-private/v1/key-id')
  const input = new Uint8Array(label.length + 1 + recipientPublicKey.length + tagPublicKey.length + bindingPublicKey.length)
  input.set(label, 0)
  input.set(recipientPublicKey, label.length + 1)
  input.set(tagPublicKey, label.length + 1 + recipientPublicKey.length)
  input.set(bindingPublicKey, label.length + 1 + recipientPublicKey.length + tagPublicKey.length)
  return `0x${toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))}`
}

/** What a key binding names: the account registering the key and the chain it registers on. */
export interface KeyBindingTarget {
  /** `0x` and 40 hex digits, any case. */
  account: string
  chainId: number | bigint
}

function hexToBytes(value: string, length: number, what: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  if (!new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(hex)) throw new EnvelopeError('BAD_KEYSTORE', `${what} must be ${length} bytes of hex`)
  return Uint8Array.from({ length }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

/**
 * The bytes a binding signature covers (SPEC.md "Key binding"): the label, a zero byte, the
 * 32-byte key id, the chain id as a 32-byte big-endian integer and the 20-byte account.
 */
export function keyBindingMessage(keyId: string, { account, chainId }: KeyBindingTarget): Uint8Array {
  const label = encoder.encode('seed-private/v1/key-binding')
  const chain = BigInt(chainId)
  if (chain < 0n || chain >= 1n << 256n) throw new EnvelopeError('BAD_KEYSTORE', 'chainId must fit in 32 bytes')
  const out = new Uint8Array(label.length + 1 + 32 + 32 + 20)
  out.set(label, 0)
  out.set(hexToBytes(keyId, 32, 'keyId'), label.length + 1)
  out.set(hexToBytes(chain.toString(16).padStart(64, '0'), 32, 'chainId'), label.length + 33)
  out.set(hexToBytes(account, 20, 'account'), label.length + 65)
  return out
}

/**
 * The identity's Ed25519 signature that it belongs to `account` on `chainId`. The account's
 * `seedprotocol.encryptionKey` registration carries it, so a reader can tell the account's own
 * key from another account's keys copied into its registration.
 */
export function signKeyBinding(identity: EncryptionIdentity, target: KeyBindingTarget): Uint8Array {
  return ed25519.sign(keyBindingMessage(identity.keyId, target), identity.bindingKey.secretKey)
}

/** Whether `signature` is `bindingPublicKey`'s binding of `keyId` to `target`. */
export function verifyKeyBinding(
  { keyId, bindingPublicKey, signature }: { keyId: string; bindingPublicKey: Uint8Array; signature: Uint8Array },
  target: KeyBindingTarget,
): boolean {
  try {
    return ed25519.verify(signature, keyBindingMessage(keyId, target), bindingPublicKey)
  } catch {
    return false
  }
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
