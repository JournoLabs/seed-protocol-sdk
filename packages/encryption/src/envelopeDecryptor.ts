/**
 * Opens downloaded envelopes for the SDK (`setEnvelopeDecryptor` in `@seedprotocol/sdk`): tries
 * each unlocked identity's recipient key and returns the plaintext with the content type recorded
 * inside, or null when the bytes aren't an envelope or none of them is a recipient. A damaged
 * envelope throws `EnvelopeError`.
 */

import { EnvelopeError, decryptEnvelope } from './envelope'
import type { EncryptionIdentity } from './identity'
import { unwrapWithSecretKeys } from './recipient'

/** What `setEnvelopeDecryptor` takes. Structural, so no SDK import. */
export type EnvelopeOpener = (envelope: Uint8Array) => Promise<{ contentType: string; body: Uint8Array } | null>

export function createEnvelopeDecryptor(identities: EncryptionIdentity[]): EnvelopeOpener {
  const unwrap = unwrapWithSecretKeys(identities.map((identity) => identity.recipient.secretKey))
  return async (envelope) => {
    try {
      const { contentType, body } = await decryptEnvelope(envelope, { unwrap })
      return { contentType, body }
    } catch (error) {
      if (error instanceof EnvelopeError && (error.code === 'NO_KEY' || error.code === 'NOT_ENVELOPE')) return null
      throw error
    }
  }
}
