import { describe, expect, it } from 'vitest'
import { createEncryptionIdentity, createEnvelopeDecryptor, createPrivateUploadEncryptor } from '../src/index'

describe('createEnvelopeDecryptor', () => {
  it("opens an upload wrapped to one of the identities and returns null for anyone else's", async () => {
    const [mine, old, stranger] = await Promise.all([createEncryptionIdentity(), createEncryptionIdentity(), createEncryptionIdentity()])
    const encrypt = createPrivateUploadEncryptor({ recipients: [old.recipient.publicKey] })
    const { blob } = await encrypt({ blob: new Blob(['<p>older Version</p>']), contentType: 'text/html' })
    const envelope = new Uint8Array(await blob.arrayBuffer())

    // A rotated identity keeps opening what was wrapped to the old one.
    const opened = await createEnvelopeDecryptor([mine, old])(envelope)
    expect(opened?.contentType).toBe('text/html')
    expect(new TextDecoder().decode(opened!.body)).toBe('<p>older Version</p>')
    expect(await createEnvelopeDecryptor([stranger])(envelope)).toBeNull()
  })

  it('returns null for bytes that are not an envelope', async () => {
    const decrypt = createEnvelopeDecryptor([await createEncryptionIdentity()])
    expect(await decrypt(new TextEncoder().encode('<p>plain</p>'))).toBeNull()
    expect(await decrypt(new Uint8Array())).toBeNull()
  })

  it('throws for an envelope that was tampered with', async () => {
    const me = await createEncryptionIdentity()
    const decrypt = createEnvelopeDecryptor([me])
    const { blob } = await createPrivateUploadEncryptor({ recipients: [me.recipient.publicKey] })({ blob: new Blob(['x']), contentType: undefined })
    const envelope = new Uint8Array(await blob.arrayBuffer())
    envelope[envelope.length - 1]! ^= 1
    await expect(decrypt(envelope)).rejects.toMatchObject({ code: 'BAD_CHUNK' })
  })
})
