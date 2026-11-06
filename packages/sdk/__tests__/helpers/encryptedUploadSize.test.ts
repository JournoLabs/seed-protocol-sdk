import { describe, expect, it } from 'vitest'
import { encryptEnvelope, generateEnvelopeId, generateFileKey, generateRecipientKeyPair, wrapFileKey } from '@seedprotocol/encryption'
import { estimateEncryptedUploadBytes } from '@/helpers/encryptedUploadSize'

// The estimate is checked against envelopes the encryption package actually writes, with a bind as
// large as an encryptor's (envelope id, chain id, publisher address).
async function envelopeSize(bodyBytes: number, recipients: number): Promise<number> {
  const fileKey = generateFileKey()
  const stanzas = await Promise.all(
    Array.from({ length: recipients }, () => wrapFileKey(fileKey, generateRecipientKeyPair().publicKey)),
  )
  const envelope = await encryptEnvelope({
    fileKey,
    bind: { envelopeId: generateEnvelopeId(), chainId: '11155420', publisher: `0x${'ab'.repeat(20)}` },
    stanzas,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    body: new Uint8Array(bodyBytes),
  })
  return envelope.length
}

describe('estimateEncryptedUploadBytes', () => {
  for (const bytes of [0, 1, 1000, 65_000, 65_536, 200_000, 1_048_576]) {
    for (const recipients of [1, 3]) {
      it(`is an upper bound within 12% plus header slack for ${bytes} bytes and ${recipients} recipient(s)`, async () => {
        const actual = await envelopeSize(bytes, recipients)
        const estimate = estimateEncryptedUploadBytes(bytes, recipients)
        expect(estimate).toBeGreaterThanOrEqual(actual)
        expect(estimate).toBeLessThanOrEqual(Math.ceil(actual * 1.13) + 600)
      })
    }
  }
})
