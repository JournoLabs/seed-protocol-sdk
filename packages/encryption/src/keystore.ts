/**
 * The keystore manifest: a seed-private/v1 envelope whose body is the identity secret, with one
 * stanza per way to unlock it (recovery phrase, a passkey's PRF, an EOA signature). It is public,
 * so every stanza must be safe to publish. SPEC.md "Keystore manifest" is the normative description.
 */

import { decodeBase64NoPad, encodeBase64NoPad } from './base64'
import {
  EnvelopeError,
  FILE_KEY_LENGTH,
  decryptEnvelope,
  encryptEnvelope,
  generateEnvelopeId,
  hkdf,
  parseEnvelopeHeader,
  type EnvelopeHeader,
  type Stanza,
} from './envelope'
import { IDENTITY_SECRET_LENGTH, encryptionIdentityFromSecret, recoveryKeyFromPhrase, type EncryptionIdentity } from './identity'
import { XWING_STANZA_TYPE, unwrapFileKey, wrapFileKey } from './recipient'

export const KEYSTORE_CONTENT_TYPE = 'application/vnd.seedprotocol.identity-secret'
export const PASSKEY_PRF_STANZA_TYPE = 'passkey-prf'
export const EOA_SIGNATURE_STANZA_TYPE = 'eoa-signature'
const SALT_LENGTH = 32
const WRAPPED_KEY_LENGTH = FILE_KEY_LENGTH + 16

const encoder = new TextEncoder()
const EMPTY = new Uint8Array(0)
const ZERO_NONCE = new Uint8Array(12)

/** The keystore's file key. It depends only on the identity, so any unlocked device can add a stanza. */
function keystoreFileKey(identity: EncryptionIdentity): Promise<Uint8Array<ArrayBuffer>> {
  return hkdf(identity.secret, EMPTY, encoder.encode('seed-private/v1/keystore'), FILE_KEY_LENGTH)
}

async function sealWithKek(kek: Uint8Array<ArrayBuffer>, fileKey: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', kek, 'AES-GCM', false, ['encrypt'])
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ZERO_NONCE }, key, fileKey))
}

async function openWithKek(kek: Uint8Array<ArrayBuffer>, body: Uint8Array): Promise<Uint8Array | null> {
  const key = await crypto.subtle.importKey('raw', kek, 'AES-GCM', false, ['decrypt'])
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ZERO_NONCE }, key, new Uint8Array(body)))
  } catch {
    return null
  }
}

function randomSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function checkArgs(stanza: Stanza, count: number, lengths: number[]): Uint8Array<ArrayBuffer>[] {
  const decoded = stanza.args.length === count ? stanza.args.map((a) => decodeBase64NoPad(a)) : []
  const ok =
    decoded.length === count &&
    decoded.every((d, i) => d !== null && (lengths[i] === 0 ? d.length > 0 : d.length === lengths[i])) &&
    stanza.body.length === WRAPPED_KEY_LENGTH
  if (!ok) throw new EnvelopeError('BAD_HEADER', `Malformed ${stanza.type} stanza`)
  return decoded as Uint8Array<ArrayBuffer>[]
}

// Recovery phrase ------------------------------------------------------------------------------

/** A stanza that lets the recovery phrase behind `recoveryPublicKey` unlock this identity. */
export async function recoveryStanza(identity: EncryptionIdentity, recoveryPublicKey: Uint8Array): Promise<Stanza> {
  return wrapFileKey(await keystoreFileKey(identity), recoveryPublicKey)
}

// Passkey PRF ----------------------------------------------------------------------------------

export interface PasskeyPrfRequest {
  credentialId: Uint8Array
  /** The PRF input (`prf.eval.first`) for this credential. */
  salt: Uint8Array
}

/**
 * Asks the user for one of `requests`' passkeys and returns its PRF output, or null when they
 * cancel or have none of them. `passkeyPrf()` is the WebAuthn implementation.
 */
export type PasskeyPrfEvaluator = (
  requests: PasskeyPrfRequest[],
) => Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array } | null>

async function passkeyKek(prfOutput: Uint8Array, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return hkdf(prfOutput, salt, encoder.encode('seed-private/v1/passkey-prf'), 32)
}

/** A new random PRF input for `passkeyStanza`. Evaluate the passkey's PRF with it, then build the stanza. */
export function generatePasskeySalt(): Uint8Array {
  return randomSalt()
}

/** A stanza that lets the passkey `credentialId` unlock this identity, given its PRF output for `salt`. */
export async function passkeyStanza(
  identity: EncryptionIdentity,
  { credentialId, salt, prfOutput }: { credentialId: Uint8Array; salt: Uint8Array; prfOutput: Uint8Array },
): Promise<Stanza> {
  if (salt.length !== SALT_LENGTH) throw new EnvelopeError('BAD_KEYSTORE', `Passkey salt must be ${SALT_LENGTH} bytes`)
  if (credentialId.length === 0 || prfOutput.length < 32) throw new EnvelopeError('BAD_KEYSTORE', 'Missing passkey credential or PRF output')
  const body = await sealWithKek(await passkeyKek(prfOutput, salt), await keystoreFileKey(identity))
  return { type: PASSKEY_PRF_STANZA_TYPE, args: [encodeBase64NoPad(credentialId), encodeBase64NoPad(salt)], body }
}

function passkeyArgs(stanza: Stanza): PasskeyPrfRequest {
  const [credentialId, salt] = checkArgs(stanza, 2, [0, SALT_LENGTH]) as [Uint8Array, Uint8Array]
  return { credentialId, salt }
}

// EOA signature --------------------------------------------------------------------------------

/**
 * The text an EOA signs with `personal_sign` (EIP-191) to unlock the identity. The salt makes it
 * different per stanza; the warning is there because the signature is the key.
 */
export function eoaSignatureMessage(salt: Uint8Array): string {
  return [
    'Unlock your Seed Protocol encryption key',
    '',
    'Signing this message lets this app read your private Versions. Anyone who gets this signature can read them too, so sign it only in apps you trust.',
    '',
    `Key: 0x${toHex(salt)}`,
  ].join('\n')
}

/** A new random salt for `eoaSignatureStanza`. Sign `eoaSignatureMessage(salt)`, then build the stanza. */
export function generateEoaSignatureSalt(): Uint8Array {
  return randomSalt()
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

/**
 * `r || s` with `s` in the lower half of the curve order. Accepts a 65-byte signature (any `v`) or a
 * 64-byte EIP-2098 one, so wallets that differ only in how they encode `v` derive the same key.
 */
function signatureKeyMaterial(signature: string): Uint8Array<ArrayBuffer> {
  const hex = signature.startsWith('0x') ? signature.slice(2) : signature
  if (!/^[0-9a-fA-F]*$/.test(hex) || (hex.length !== 130 && hex.length !== 128)) {
    throw new EnvelopeError('BAD_KEYSTORE', 'Signature must be 64 or 65 bytes of hex')
  }
  const r = hex.slice(0, 64)
  let s = BigInt(`0x${hex.slice(64, 128)}`)
  if (hex.length === 128) s &= (1n << 255n) - 1n
  if (s > SECP256K1_N / 2n) s = SECP256K1_N - s
  const out = new Uint8Array(64)
  const full = r + s.toString(16).padStart(64, '0')
  for (let i = 0; i < 64; i++) out[i] = parseInt(full.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function signatureKek(signature: string, salt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return hkdf(signatureKeyMaterial(signature), salt, encoder.encode('seed-private/v1/eoa-signature'), 32)
}

/**
 * A stanza that lets an EOA unlock this identity by signing `eoaSignatureMessage(salt)` again.
 * Only for EOAs whose wallet signs deterministically (RFC 6979); smart-account signatures change
 * every time and would never unlock it.
 */
export async function eoaSignatureStanza(
  identity: EncryptionIdentity,
  { salt, signature }: { salt: Uint8Array; signature: string },
): Promise<Stanza> {
  if (salt.length !== SALT_LENGTH) throw new EnvelopeError('BAD_KEYSTORE', `Signature salt must be ${SALT_LENGTH} bytes`)
  const body = await sealWithKek(await signatureKek(signature, salt), await keystoreFileKey(identity))
  return { type: EOA_SIGNATURE_STANZA_TYPE, args: [encodeBase64NoPad(salt)], body }
}

// Manifest -------------------------------------------------------------------------------------

/** A keystore manifest for `identity` carrying `stanzas`. Each call picks a new envelope id. */
export async function buildKeystoreManifest(identity: EncryptionIdentity, stanzas: Stanza[]): Promise<Uint8Array> {
  if (stanzas.length === 0) throw new EnvelopeError('BAD_KEYSTORE', 'A keystore manifest needs at least one stanza')
  return encryptEnvelope({
    fileKey: await keystoreFileKey(identity),
    bind: { envelopeId: generateEnvelopeId(), keyId: identity.keyId, purpose: 'keystore' },
    stanzas,
    contentType: KEYSTORE_CONTENT_TYPE,
    body: identity.secret,
  })
}

export type KeystoreAuthenticator =
  | { type: 'recovery' }
  | { type: 'passkey'; credentialId: Uint8Array }
  | { type: 'eoa-signature'; salt: Uint8Array }

/** The key id a manifest claims and the authenticators that can unlock it. Doesn't decrypt anything. */
export function describeKeystoreManifest(bytes: Uint8Array): { keyId: string; authenticators: KeystoreAuthenticator[] } {
  const header = keystoreHeader(bytes)
  const authenticators: KeystoreAuthenticator[] = []
  for (const stanza of header.stanzas) {
    if (stanza.type === XWING_STANZA_TYPE) authenticators.push({ type: 'recovery' })
    else if (stanza.type === PASSKEY_PRF_STANZA_TYPE) authenticators.push({ type: 'passkey', credentialId: passkeyArgs(stanza).credentialId })
    else if (stanza.type === EOA_SIGNATURE_STANZA_TYPE) authenticators.push({ type: 'eoa-signature', salt: checkArgs(stanza, 1, [SALT_LENGTH])[0]! })
  }
  return { keyId: header.bind.keyId!, authenticators }
}

function keystoreHeader(bytes: Uint8Array): EnvelopeHeader {
  const header = parseEnvelopeHeader(bytes)
  if (header.bind.purpose !== 'keystore' || !/^0x[0-9a-f]{64}$/.test(header.bind.keyId ?? '')) {
    throw new EnvelopeError('BAD_KEYSTORE', 'Not a keystore manifest')
  }
  return header
}

export type KeystoreUnlock =
  | { recoveryPhrase: string }
  | { passkey: PasskeyPrfEvaluator }
  | { signMessage: (message: string) => Promise<string> }

async function unwrapKeystore(header: EnvelopeHeader, unlock: KeystoreUnlock): Promise<Uint8Array | null> {
  if ('recoveryPhrase' in unlock) {
    const { secretKey } = await recoveryKeyFromPhrase(unlock.recoveryPhrase)
    for (const stanza of header.stanzas) {
      const fileKey = await unwrapFileKey(stanza, secretKey)
      if (fileKey) return fileKey
    }
    return null
  }
  if ('passkey' in unlock) {
    const stanzas = header.stanzas.filter((s) => s.type === PASSKEY_PRF_STANZA_TYPE)
    if (stanzas.length === 0) return null
    const requests = stanzas.map(passkeyArgs)
    const result = await unlock.passkey(requests)
    if (!result) return null
    for (let i = 0; i < stanzas.length; i++) {
      if (!sameBytes(requests[i]!.credentialId, result.credentialId)) continue
      const fileKey = await openWithKek(await passkeyKek(result.prfOutput, requests[i]!.salt), stanzas[i]!.body)
      if (fileKey) return fileKey
    }
    return null
  }
  for (const stanza of header.stanzas) {
    if (stanza.type !== EOA_SIGNATURE_STANZA_TYPE) continue
    const [salt] = checkArgs(stanza, 1, [SALT_LENGTH]) as [Uint8Array]
    const signature = await unlock.signMessage(eoaSignatureMessage(salt))
    const fileKey = await openWithKek(await signatureKek(signature, salt), stanza.body)
    if (fileKey) return fileKey
  }
  return null
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Unlocks a keystore manifest and returns the identity. Throws NO_KEY when the authenticator
 * opens no stanza, and BAD_KEYSTORE when the manifest's contents don't match its key id (pass
 * `expectKeyId`, from the registration attestation, to also reject another identity's manifest).
 */
export async function openKeystoreManifest(
  bytes: Uint8Array,
  unlock: KeystoreUnlock,
  options: { expectKeyId?: string } = {},
): Promise<EncryptionIdentity> {
  const header = keystoreHeader(bytes)
  if (options.expectKeyId !== undefined && header.bind.keyId !== options.expectKeyId) {
    throw new EnvelopeError('BIND_MISMATCH', 'Keystore manifest is for another key id')
  }
  const unwrapped: { fileKey: Uint8Array | null } = { fileKey: null }
  const opened = await decryptEnvelope(bytes, {
    unwrap: async (h) => (unwrapped.fileKey = await unwrapKeystore(h, unlock)),
  })
  if (opened.contentType !== KEYSTORE_CONTENT_TYPE || opened.body.length !== IDENTITY_SECRET_LENGTH) {
    throw new EnvelopeError('BAD_KEYSTORE', 'Keystore manifest body is not an identity secret')
  }
  const identity = await encryptionIdentityFromSecret(opened.body)
  if (identity.keyId !== header.bind.keyId || !sameBytes(await keystoreFileKey(identity), unwrapped.fileKey!)) {
    throw new EnvelopeError('BAD_KEYSTORE', 'Keystore manifest contents do not match its key id')
  }
  return identity
}
