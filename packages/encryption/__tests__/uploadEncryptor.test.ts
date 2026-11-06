import { describe, expect, it } from 'vitest'
import {
  EnvelopeError,
  createPrivateUploadEncryptor,
  decryptEnvelope,
  generateRecipientKeyPair,
  parseEnvelopeHeader,
  unwrapWithSecretKeys,
} from '../src/index'

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('createPrivateUploadEncryptor', () => {
  it('encrypts each upload to every recipient, keeping the real content type inside', async () => {
    const publisher = generateRecipientKeyPair()
    const editor = generateRecipientKeyPair()
    const encrypt = createPrivateUploadEncryptor({
      recipients: [publisher.publicKey, editor.publicKey],
      bind: { chainId: '11155420', publisher: '0x' + 'ab'.repeat(20) },
    })
    const body = new TextEncoder().encode('<p>only us</p>')
    const { blob, tags } = await encrypt({ blob: new Blob([body]), contentType: 'text/html' })
    expect(tags).toEqual([{ name: 'Seed-Encryption', value: 'seed-private/v1' }])

    const envelope = await bytesOf(blob)
    expect(new TextDecoder().decode(envelope)).not.toContain('only us')
    const header = parseEnvelopeHeader(envelope)
    expect(header.bind).toMatchObject({ chainId: '11155420', publisher: '0x' + 'ab'.repeat(20) })
    expect(header.stanzas.map((s) => s.type)).toEqual(['mlkem768x25519', 'mlkem768x25519'])
    for (const reader of [publisher, editor]) {
      const opened = await decryptEnvelope(envelope, { unwrap: unwrapWithSecretKeys([reader.secretKey]) })
      expect(opened).toMatchObject({ contentType: 'text/html', body })
    }
  })

  it('uses a new file key and envelope id for every upload', async () => {
    const me = generateRecipientKeyPair()
    const encrypt = createPrivateUploadEncryptor({ recipients: [me.publicKey] })
    const upload = { blob: new Blob(['same']), contentType: undefined }
    const [a, b] = await Promise.all([encrypt(upload), encrypt(upload)])
    const [ha, hb] = [parseEnvelopeHeader(await bytesOf(a.blob)), parseEnvelopeHeader(await bytesOf(b.blob))]
    expect(ha.bind.envelopeId).not.toBe(hb.bind.envelopeId)
    expect(ha.stanzas[0]!.args[0]).not.toBe(hb.stanzas[0]!.args[0])
    const opened = await decryptEnvelope(await bytesOf(a.blob), { unwrap: unwrapWithSecretKeys([me.secretKey]) })
    expect(opened.contentType).toBe('application/octet-stream')
  })

  it('refuses no recipients, a wrong-length key and a bind that sets envelopeId', () => {
    const key = generateRecipientKeyPair().publicKey
    expect(() => createPrivateUploadEncryptor({ recipients: [] })).toThrow(EnvelopeError)
    expect(() => createPrivateUploadEncryptor({ recipients: [key.subarray(1)] })).toThrow(EnvelopeError)
    expect(() => createPrivateUploadEncryptor({ recipients: [key], bind: { envelopeId: '0x' + '00'.repeat(32) } })).toThrow(EnvelopeError)
  })
})
