import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  EnvelopeError,
  decryptEnvelope,
  encryptEnvelope,
  generateEnvelopeId,
  generateFileKey,
  isEnvelope,
  parseEnvelopeHeader,
  type EnvelopeBind,
  type EnvelopeErrorCode,
  type Stanza,
} from '../src/index'
import { encryptEnvelopeWithNonce } from '../src/envelope'
import { referenceEncrypt } from './reference'
import vectorFile from './vectors.json'

const hex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'))
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255)
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const text = new TextEncoder()

const fileKey = hex(vectorFile.fileKeyHex)
const payloadNonce = hex(vectorFile.payloadNonceHex)

function vectorInput(v: (typeof vectorFile.vectors)[number]) {
  return {
    fileKey,
    bind: v.bind as EnvelopeBind,
    stanzas: v.stanzas.map((s) => ({ type: s.type, args: s.args, body: hex(s.bodyHex) })),
    contentType: v.contentType,
    body: 'bodyText' in v && v.bodyText !== undefined ? text.encode(v.bodyText) : pattern(v.bodyPattern!.length),
  }
}

async function expectCode(promise: Promise<unknown>, code: EnvelopeErrorCode) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof EnvelopeError && e.code === code)
}

describe('seed-private/v1 vectors', () => {
  for (const v of vectorFile.vectors) {
    it(`encrypts "${v.name}" to the vector bytes`, async () => {
      const envelope = await encryptEnvelopeWithNonce(vectorInput(v), payloadNonce)
      expect(envelope.length).toBe(v.envelopeLength)
      expect(sha256(envelope)).toBe(v.envelopeSha256)
      if ('envelopeHex' in v && v.envelopeHex) expect(Buffer.from(envelope).toString('hex')).toBe(v.envelopeHex)
    })

    it(`decrypts "${v.name}"`, async () => {
      const input = vectorInput(v)
      const envelope = await encryptEnvelopeWithNonce(input, payloadNonce)
      const opened = await decryptEnvelope(envelope, { fileKey })
      expect(opened.contentType).toBe(v.contentType)
      expect(opened.bind).toEqual(v.bind)
      expect(sha256(opened.body)).toBe(sha256(input.body))
      expect(parseEnvelopeHeader(envelope).stanzas).toEqual(input.stanzas)
    })
  }

  it('matches the node:crypto reference on random inputs', async () => {
    for (const length of [0, 1, CHUNK_SIZE - 10, CHUNK_SIZE * 2 + 5]) {
      const key = generateFileKey()
      const nonce = crypto.getRandomValues(new Uint8Array(16))
      const body = crypto.getRandomValues(new Uint8Array(Math.min(length, 65536)))
      const full = length > 65536 ? new Uint8Array(length).map((_, i) => body[i % body.length]!) : body
      const input = {
        fileKey: key,
        bind: { envelopeId: generateEnvelopeId(), seed: 'abc' },
        stanzas: [{ type: 'x-test', args: ['r'], body: crypto.getRandomValues(new Uint8Array(length % 97)) }],
        contentType: 'application/octet-stream',
        body: full,
      }
      const ours = await encryptEnvelopeWithNonce(input, nonce)
      const theirs = referenceEncrypt({
        ...input,
        fileKey: Buffer.from(key),
        body: Buffer.from(full),
        payloadNonce: Buffer.from(nonce),
        stanzas: input.stanzas.map((s) => ({ ...s, body: Buffer.from(s.body) })),
      })
      expect(Buffer.from(ours).equals(theirs)).toBe(true)
    }
  })
})

describe('encryptEnvelope', () => {
  const stanzas: Stanza[] = [{ type: 'x-test', args: [], body: new Uint8Array([1, 2, 3]) }]

  it('round-trips through an unwrap callback that sees the header', async () => {
    const key = generateFileKey()
    const bind = { envelopeId: generateEnvelopeId(), chainId: '10' }
    const envelope = await encryptEnvelope({ fileKey: key, bind, stanzas, contentType: 'text/markdown', body: text.encode('# hi') })
    expect(isEnvelope(envelope)).toBe(true)
    const opened = await decryptEnvelope(envelope, {
      unwrap: (header) => (header.stanzas[0]?.type === 'x-test' && header.bind.chainId === '10' ? key : null),
      expectBind: { envelopeId: bind.envelopeId },
    })
    expect(new TextDecoder().decode(opened.body)).toBe('# hi')
    expect(opened.contentType).toBe('text/markdown')
  })

  it('uses a fresh payload nonce each time', async () => {
    const input = { fileKey: generateFileKey(), bind: { envelopeId: generateEnvelopeId() }, stanzas, contentType: 'text/plain', body: text.encode('same') }
    const a = await encryptEnvelope(input)
    const b = await encryptEnvelope(input)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('keeps the content type out of the clear', async () => {
    const envelope = await encryptEnvelope({ fileKey: generateFileKey(), bind: { envelopeId: generateEnvelopeId() }, stanzas, contentType: 'image/x-very-telling', body: new Uint8Array(10) })
    expect(Buffer.from(envelope).includes('very-telling')).toBe(false)
  })

  it('rejects a bad envelope id, bind key, file key or empty stanza list', async () => {
    const base = { fileKey: generateFileKey(), bind: { envelopeId: generateEnvelopeId() }, stanzas, contentType: 'text/plain', body: new Uint8Array() }
    await expectCode(encryptEnvelope({ ...base, bind: { envelopeId: '0x12' } }), 'BAD_BIND')
    await expectCode(encryptEnvelope({ ...base, bind: { ...base.bind, 'bad key': 'x' } }), 'BAD_BIND')
    await expectCode(encryptEnvelope({ ...base, fileKey: new Uint8Array(16) }), 'BAD_FILE_KEY')
    await expectCode(encryptEnvelope({ ...base, stanzas: [] }), 'BAD_HEADER')
    await expectCode(encryptEnvelope({ ...base, stanzas: [{ type: 'has space', args: [], body: new Uint8Array() }] }), 'BAD_HEADER')
  })
})

describe('decryptEnvelope failures', () => {
  // Three chunks: 200000 bytes of body.
  const v = vectorFile.vectors.find((x) => x.name === 'three chunks')!
  const make = () => encryptEnvelopeWithNonce(vectorInput(v), payloadNonce)
  const headerEnd = (env: Uint8Array) => Buffer.from(env).indexOf('\n', Buffer.from(env).indexOf('--- ')) + 1

  it('fails on a wrong key with HEADER_MAC', async () => {
    await expectCode(decryptEnvelope(await make(), { fileKey: generateFileKey() }), 'HEADER_MAC')
  })

  it('fails when no stanza unwraps', async () => {
    await expectCode(decryptEnvelope(await make(), { unwrap: () => null }), 'NO_KEY')
  })

  it('fails when the bind does not match what the attestation says', async () => {
    await expectCode(decryptEnvelope(await make(), { fileKey, expectBind: { envelopeId: '0x' + '33'.repeat(32) } }), 'BIND_MISMATCH')
  })

  it('fails on an altered header byte', async () => {
    const env = await make()
    const i = Buffer.from(env).indexOf('-> x-test') + 3
    env[i] = 'y'.charCodeAt(0)
    await expectCode(decryptEnvelope(env, { fileKey }), 'HEADER_MAC')
  })

  it('fails on an altered payload byte', async () => {
    const env = await make()
    const at = headerEnd(env) + 16 + 70000
    env[at] = env[at]! ^ 1
    await expectCode(decryptEnvelope(env, { fileKey }), 'BAD_CHUNK')
  })

  it('fails when the final chunk is cut off at a chunk boundary', async () => {
    const env = await make()
    const twoChunks = headerEnd(env) + 16 + 2 * (CHUNK_SIZE + 16)
    await expectCode(decryptEnvelope(env.subarray(0, twoChunks), { fileKey }), 'TRUNCATED')
  })

  it('fails when the last byte is missing', async () => {
    const env = await make()
    await expectCode(decryptEnvelope(env.subarray(0, env.length - 1), { fileKey }), 'BAD_CHUNK')
  })

  it('fails when bytes follow a full-size final chunk', async () => {
    const full = vectorFile.vectors.find((x) => x.name === 'plaintext exactly one chunk')!
    const env = await encryptEnvelopeWithNonce(vectorInput(full), payloadNonce)
    const longer = new Uint8Array(env.length + 20)
    longer.set(env)
    await expectCode(decryptEnvelope(longer, { fileKey }), 'TRAILING_DATA')
  })

  it('fails when bytes follow a short final chunk', async () => {
    // Indistinguishable from a corrupted final chunk, as in age.
    const env = await make()
    const longer = new Uint8Array(env.length + 20)
    longer.set(env)
    await expectCode(decryptEnvelope(longer, { fileKey }), 'BAD_CHUNK')
  })

  it('fails when the payload is shorter than a nonce and a tag', async () => {
    const env = await make()
    await expectCode(decryptEnvelope(env.subarray(0, headerEnd(env) + 20), { fileKey }), 'TRUNCATED')
  })

  it('reports other bytes as not an envelope', async () => {
    expect(isEnvelope(text.encode('<html>'))).toBe(false)
    await expectCode(decryptEnvelope(text.encode('seed-private/v2\n'), { fileKey }), 'NOT_ENVELOPE')
  })

  it('rejects a bind line that is not canonical', async () => {
    const bindJson = Buffer.from('{"envelopeId":"0x' + '11'.repeat(32) + '","a":"b"}').toString('base64').replace(/=+$/, '')
    const forged = text.encode(`seed-private/v1\nbind ${bindJson}\n-> x-test\nAQ\n--- ${'A'.repeat(43)}\n`)
    await expectCode(decryptEnvelope(forged, { fileKey }), 'BAD_BIND')
  })

  it('rejects a stanza body that is not canonical base64', async () => {
    const env = Buffer.from(await encryptEnvelopeWithNonce({ ...vectorInput(vectorFile.vectors[0]!) }, payloadNonce))
    // The short-text stanza body is 43 characters ending in '8' (low bits 00); '9' sets a trailing bit.
    const at = env.indexOf('\n', env.indexOf('-> x-test')) + 43
    expect(String.fromCharCode(env[at]!)).toBe('8')
    env[at] = '9'.charCodeAt(0)
    expect(() => parseEnvelopeHeader(env)).toThrow(EnvelopeError)
  })
})
