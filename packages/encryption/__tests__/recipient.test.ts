import { createHash } from 'node:crypto'
import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js'
import { describe, expect, it } from 'vitest'
import {
  EnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  generateEnvelopeId,
  generateFileKey,
  generateRecipientKeyPair,
  unwrapFileKey,
  unwrapWithSecretKeys,
  wrapFileKey,
  type EnvelopeErrorCode,
  type Stanza,
} from '../src/index'
import { encryptEnvelopeWithNonce } from '../src/envelope'
import { wrapFileKeyWithRandomness } from '../src/recipient'
import { referenceXWingStanza } from './reference'
import vectorFile from './vectors.json'

const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'))
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

const fileKey = hex(vectorFile.fileKeyHex)
const vectors = Object.fromEntries(vectorFile.recipientVectors.map((v) => [v.name, v]))
const vectorStanza = (name: string): Stanza => {
  const s = vectors[name]!.stanza
  return { type: s.type, args: s.args, body: hex(s.bodyHex) }
}

async function expectCode(promise: Promise<unknown>, code: EnvelopeErrorCode) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof EnvelopeError && e.code === code)
}

describe('X-Wing KEM', () => {
  it('matches the first test vector of draft-connolly-cfrg-xwing-kem-10', () => {
    const { publicKey } = ml_kem768_x25519.keygen(hex('7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26'))
    expect(toHex(publicKey.subarray(0, 32))).toBe('e2236b35a8c24b39b10aa1323a96a919a2ced88400633a7b07131713fc14b2b5')
    expect(toHex(publicKey.subarray(-32))).toBe('859edb06eff389b27dce59844570216223593d4ba32d9abac8cd049040ef6534')
    const { cipherText, sharedSecret } = ml_kem768_x25519.encapsulate(
      publicKey,
      hex('3cb1eea988004b93103cfb0aeefd2a686e01fa4a58e8a3639ca8a1e3f9ae57e235b8cc873c23dc62b8d260169afa2f75ab916a58d974918835d25e6a435085b2'),
    )
    expect(toHex(cipherText.subarray(0, 32))).toBe('b83aa828d4d62b9a83ceffe1d3d3bb1ef31264643c070c5798927e41fb07914a')
    expect(toHex(cipherText.subarray(-32))).toBe('e56f17576740ce2a32fc5145030145cfb97e63e0e41d354274a079d3e6fb2e15')
    expect(toHex(sharedSecret)).toBe('d2df0522128f09dd8e2c92b1e905c793d8f57a54c3da25861f10bf4ca613e384')
  })
})

describe('mlkem768x25519 stanza vectors', () => {
  for (const v of vectorFile.recipientVectors) {
    it(`wraps "${v.name}" to the same bytes as hpke-js`, async () => {
      const { publicKey } = generateRecipientKeyPair(hex(v.recipientSeedHex))
      expect(sha256(publicKey)).toBe(v.publicKeySha256)
      const stanza = await wrapFileKeyWithRandomness(fileKey, publicKey, hex(v.randomnessHex))
      expect(stanza).toEqual(vectorStanza(v.name))
    })

    it(`unwraps "${v.name}"`, async () => {
      expect(await unwrapFileKey(vectorStanza(v.name), hex(v.recipientSeedHex))).toEqual(fileKey)
    })
  }

  it('matches hpke-js on random seeds, randomness and file keys', async () => {
    for (let i = 0; i < 5; i++) {
      const [seed, randomness, key] = [32, 64, 32].map((n) => crypto.getRandomValues(new Uint8Array(n))) as [Uint8Array, Uint8Array, Uint8Array]
      const theirs = await referenceXWingStanza(Buffer.from(key), Buffer.from(seed), Buffer.from(randomness))
      const { publicKey } = generateRecipientKeyPair(seed)
      expect(Buffer.from(publicKey).equals(theirs.publicKey)).toBe(true)
      const ours = await wrapFileKeyWithRandomness(key, publicKey, randomness)
      expect(ours.args).toEqual(theirs.stanza.args)
      expect(Buffer.from(ours.body).equals(theirs.stanza.body)).toBe(true)
    }
  })

  it('reproduces the envelope wrapped to the publisher and the recovery key', async () => {
    const e = vectorFile.recipientEnvelope
    const envelope = await encryptEnvelopeWithNonce(
      {
        fileKey,
        bind: e.bind,
        stanzas: e.stanzas.map(vectorStanza),
        contentType: e.contentType,
        body: new TextEncoder().encode(e.bodyText),
        padding: e.padding as 'padme',
      },
      hex(vectorFile.payloadNonceHex),
    )
    expect(envelope.length).toBe(e.envelopeLength)
    expect(sha256(envelope)).toBe(e.envelopeSha256)

    for (const holder of ['publisher', 'recovery']) {
      const opened = await decryptEnvelope(envelope, { unwrap: unwrapWithSecretKeys([hex(vectors[holder]!.recipientSeedHex)]) })
      expect(new TextDecoder().decode(opened.body)).toBe(e.bodyText)
    }
    await expectCode(decryptEnvelope(envelope, { unwrap: unwrapWithSecretKeys([generateRecipientKeyPair().secretKey]) }), 'NO_KEY')
  })
})

describe('wrapFileKey and unwrapFileKey', () => {
  it('round-trips a fresh key pair and returns null for anyone else', async () => {
    const me = generateRecipientKeyPair()
    const key = generateFileKey()
    const stanza = await wrapFileKey(key, me.publicKey)
    expect(stanza.type).toBe('mlkem768x25519')
    expect(await unwrapFileKey(stanza, me.secretKey)).toEqual(key)
    expect(await unwrapFileKey(stanza, generateRecipientKeyPair().secretKey)).toBeNull()
  })

  it('uses new encapsulation randomness for every wrap', async () => {
    const { publicKey } = generateRecipientKeyPair()
    const key = generateFileKey()
    const [a, b] = await Promise.all([wrapFileKey(key, publicKey), wrapFileKey(key, publicKey)])
    expect(a.args[0]).not.toBe(b.args[0])
  })

  it('derives the same key pair from the same seed', () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    expect(generateRecipientKeyPair(seed)).toEqual(generateRecipientKeyPair(seed))
    expect(generateRecipientKeyPair(seed).secretKey).toEqual(seed)
  })

  it('ignores stanzas of other types', async () => {
    expect(await unwrapFileKey({ type: 'x-test', args: [], body: new Uint8Array(48) }, hex(vectors.publisher!.recipientSeedHex))).toBeNull()
  })

  it('rejects a malformed mlkem768x25519 stanza', async () => {
    const good = vectorStanza('publisher')
    const key = hex(vectors.publisher!.recipientSeedHex)
    await expectCode(unwrapFileKey({ ...good, args: [] }, key), 'BAD_HEADER')
    await expectCode(unwrapFileKey({ ...good, args: [good.args[0]!, 'extra'] }, key), 'BAD_HEADER')
    await expectCode(unwrapFileKey({ ...good, args: [good.args[0]!.slice(0, -4)] }, key), 'BAD_HEADER')
    await expectCode(unwrapFileKey({ ...good, body: good.body.subarray(1) }, key), 'BAD_HEADER')
  })

  it('rejects keys of the wrong length', async () => {
    expect(() => generateRecipientKeyPair(new Uint8Array(31))).toThrow(EnvelopeError)
    await expectCode(wrapFileKey(generateFileKey(), new Uint8Array(1215)), 'BAD_RECIPIENT_KEY')
    await expectCode(wrapFileKey(new Uint8Array(16), generateRecipientKeyPair().publicKey), 'BAD_FILE_KEY')
    await expectCode(unwrapFileKey(vectorStanza('publisher'), new Uint8Array(16)), 'BAD_RECIPIENT_KEY')
  })

  it('works end to end with encryptEnvelope', async () => {
    const publisher = generateRecipientKeyPair()
    const recovery = generateRecipientKeyPair()
    const key = generateFileKey()
    const envelope = await encryptEnvelope({
      fileKey: key,
      bind: { envelopeId: generateEnvelopeId() },
      stanzas: [await wrapFileKey(key, publisher.publicKey), await wrapFileKey(key, recovery.publicKey)],
      contentType: 'application/json',
      body: new TextEncoder().encode('{"title":"private"}'),
    })
    const opened = await decryptEnvelope(envelope, { unwrap: unwrapWithSecretKeys([recovery.secretKey]) })
    expect(opened.contentType).toBe('application/json')
  })
})
