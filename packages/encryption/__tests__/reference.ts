/**
 * A second implementation of SPEC.md's encryption, written against node:crypto and sharing no
 * code with src/. The vectors were produced with it, and the tests check src/ against both.
 */
import { createCipheriv, createHash, createHmac, createPrivateKey, createPublicKey, hkdfSync, sign } from 'node:crypto'

export interface ReferenceStanza {
  type: string
  args: string[]
  body: Buffer
}

export interface ReferenceInput {
  fileKey: Buffer
  bind: Record<string, string>
  stanzas: ReferenceStanza[]
  contentType: string
  body: Buffer
  payloadNonce: Buffer
  padding?: 'padme' | 'none'
  /** Replaces the content frame, to build envelopes whose plaintext src/ would never produce. */
  plaintext?: Buffer
}

/** PADMÉ, written from the paper's definition with logarithms rather than src/'s loops. */
export function referencePadme(length: number): number {
  if (length < 2) return length
  const e = Math.floor(Math.log2(length))
  const s = Math.floor(Math.log2(e)) + 1
  const mask = 2 ** (e - s) - 1
  return Number((BigInt(length) + BigInt(mask)) & ~BigInt(mask))
}

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '')

function stanzaText({ type, args, body }: ReferenceStanza): string {
  const encoded = b64(body)
  const lines: string[] = []
  for (let i = 0; i <= encoded.length; i += 64) lines.push(encoded.slice(i, i + 64))
  return `-> ${[type, ...args].join(' ')}\n${lines.join('\n')}\n`
}

export function referenceEncrypt(input: ReferenceInput): Buffer {
  const bindText = JSON.stringify(Object.fromEntries(Object.keys(input.bind).sort().map((k) => [k, input.bind[k]])))
  const prefix = Buffer.from(
    `seed-private/v1\nbind ${b64(Buffer.from(bindText))}\n${input.stanzas.map(stanzaText).join('')}---`,
  )
  const macKey = Buffer.from(hkdfSync('sha256', input.fileKey, Buffer.alloc(0), 'seed-private/v1/header', 32))
  const mac = createHmac('sha256', macKey).update(prefix).digest()

  const info = Buffer.concat([Buffer.from('seed-private/v1/payload'), Buffer.from([0]), Buffer.from(bindText)])
  const key = Buffer.from(hkdfSync('sha256', input.fileKey, input.payloadNonce, info, 32))
  const meta = Buffer.from(JSON.stringify({ bodyLength: input.body.length, contentType: input.contentType }))
  const len = Buffer.alloc(4)
  len.writeUInt32BE(meta.length)
  const unpadded = 4 + meta.length + input.body.length
  const padded = (input.padding ?? 'padme') === 'padme' ? referencePadme(unpadded) : unpadded
  const plain = input.plaintext ?? Buffer.concat([len, meta, input.body, Buffer.alloc(padded - unpadded)])

  const chunks: Buffer[] = []
  const count = Math.max(1, Math.ceil(plain.length / 65536))
  for (let i = 0; i < count; i++) {
    const iv = Buffer.alloc(12)
    iv.writeUIntBE(i, 5, 6)
    iv[11] = i === count - 1 ? 1 : 0
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    chunks.push(cipher.update(plain.subarray(i * 65536, (i + 1) * 65536)), cipher.final(), cipher.getAuthTag())
  }
  return Buffer.concat([prefix, Buffer.from(` ${b64(mac)}\n`), input.payloadNonce, ...chunks])
}

/**
 * The mlkem768x25519 stanza, built with hpke-js (`@hpke/core`, `@hpke/hybridkem-x-wing`), whose
 * ML-KEM, X25519 and HPKE code is independent of src/'s `@noble/post-quantum` and WebCrypto code.
 */
export async function referenceXWingStanza(
  fileKey: Buffer,
  recipientSeed: Buffer,
  randomness: Buffer,
): Promise<{ publicKey: Buffer; stanza: ReferenceStanza }> {
  const { CipherSuite, HkdfSha256, Aes256Gcm } = await import('@hpke/core')
  const { XWing } = await import('@hpke/hybridkem-x-wing')
  const kem = new XWing()
  const pair = await kem.generateKeyPairDerand(new Uint8Array(recipientSeed))
  const publicKey = Buffer.from(await kem.serializePublicKey(pair.publicKey))
  const suite = new CipherSuite({ kem, kdf: new HkdfSha256(), aead: new Aes256Gcm() })
  const { enc, ct } = await suite.seal(
    { recipientPublicKey: pair.publicKey, ekm: new Uint8Array(randomness), info: Buffer.from('seed-private/v1/mlkem768x25519') },
    new Uint8Array(fileKey),
  )
  return { publicKey, stanza: { type: 'mlkem768x25519', args: [b64(Buffer.from(enc))], body: Buffer.from(ct) } }
}

const hkdf = (ikm: Buffer, salt: Buffer, info: string) => Buffer.from(hkdfSync('sha256', ikm, salt, info, 32))

/** SPEC.md "Identity": the derived public keys and key id, using hpke-js for X-Wing and node:crypto for X25519 and Ed25519. */
export async function referenceIdentity(
  secret: Buffer,
): Promise<{ xwingPublicKey: Buffer; x25519PublicKey: Buffer; ed25519PublicKey: Buffer; keyId: string }> {
  const { XWing } = await import('@hpke/hybridkem-x-wing')
  const kem = new XWing()
  const pair = await kem.generateKeyPairDerand(new Uint8Array(hkdf(secret, Buffer.alloc(0), 'seed-private/v1/identity/mlkem768x25519')))
  const xwingPublicKey = Buffer.from(await kem.serializePublicKey(pair.publicKey))
  const x25519PublicKey = rawPublicKey(X25519_PKCS8_PREFIX, hkdf(secret, Buffer.alloc(0), 'seed-private/v1/identity/x25519'))
  const ed25519PublicKey = rawPublicKey(ED25519_PKCS8_PREFIX, hkdf(secret, Buffer.alloc(0), 'seed-private/v1/identity/ed25519'))
  const keyId = createHash('sha256')
    .update(Buffer.from('seed-private/v1/key-id\0'))
    .update(xwingPublicKey)
    .update(x25519PublicKey)
    .update(ed25519PublicKey)
    .digest('hex')
  return { xwingPublicKey, x25519PublicKey, ed25519PublicKey, keyId: `0x${keyId}` }
}

const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function rawPublicKey(pkcs8Prefix: Buffer, secretKey: Buffer): Buffer {
  const key = createPrivateKey({ key: Buffer.concat([pkcs8Prefix, secretKey]), format: 'der', type: 'pkcs8' })
  return Buffer.from(createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32))
}

/** SPEC.md "Key binding": the identity's Ed25519 signature over the label, key id, chain id and account. */
export function referenceKeyBindingSignature(secret: Buffer, keyId: string, chainId: bigint, account: string): Buffer {
  const message = Buffer.concat([
    Buffer.from('seed-private/v1/key-binding\0'),
    Buffer.from(keyId.slice(2), 'hex'),
    Buffer.from(chainId.toString(16).padStart(64, '0'), 'hex'),
    Buffer.from(account.slice(2), 'hex'),
  ])
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, hkdf(secret, Buffer.alloc(0), 'seed-private/v1/identity/ed25519')]),
    format: 'der',
    type: 'pkcs8',
  })
  return sign(null, message, key)
}

export function referenceKeystoreFileKey(secret: Buffer): Buffer {
  return hkdf(secret, Buffer.alloc(0), 'seed-private/v1/keystore')
}

export function referenceRecoverySeed(entropy: Buffer): Buffer {
  return hkdf(entropy, Buffer.alloc(0), 'seed-private/v1/recovery/mlkem768x25519')
}

function sealZeroNonce(kek: Buffer, fileKey: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', kek, Buffer.alloc(12))
  return Buffer.concat([cipher.update(fileKey), cipher.final(), cipher.getAuthTag()])
}

export function referencePasskeyStanza(fileKey: Buffer, credentialId: Buffer, salt: Buffer, prfOutput: Buffer): ReferenceStanza {
  return { type: 'passkey-prf', args: [b64(credentialId), b64(salt)], body: sealZeroNonce(hkdf(prfOutput, salt, 'seed-private/v1/passkey-prf'), fileKey) }
}

/** `signature` is 65 bytes with a low `s`, so `r || s` is its first 64 bytes. */
export function referenceEoaSignatureStanza(fileKey: Buffer, salt: Buffer, signature: Buffer): ReferenceStanza {
  return { type: 'eoa-signature', args: [b64(salt)], body: sealZeroNonce(hkdf(signature.subarray(0, 64), salt, 'seed-private/v1/eoa-signature'), fileKey) }
}
