/**
 * Encrypts the uploads of private properties for `@seedprotocol/publish` (its
 * `encryptPrivateUpload` config, the SDK's `encryptUpload`). Each upload becomes its own envelope
 * with a fresh file key and envelope id, wrapped to every recipient. It needs only public keys, so
 * a session key can publish private Versions wrapped to the account's registered key.
 */

import { ENVELOPE_FORMAT_TAG, EnvelopeError, encryptEnvelope, generateEnvelopeId, generateFileKey, type EnvelopePadding } from './envelope'
import { XWING_PUBLIC_KEY_LENGTH, wrapFileKey } from './recipient'

export interface PrivateUploadEncryptorOptions {
  /**
   * X-Wing public keys to wrap each upload's file key to. Always include the publisher's
   * registered key (`recipientKey` from `getVerifiedEncryptionKey` in `@seedprotocol/publish`), or the
   * publisher can't read the Version on another device.
   */
  recipients: Uint8Array[]
  /** Bind values known before upload, such as `chainId` and `publisher`. `envelopeId` is added per upload. */
  bind?: Record<string, string>
  /** Default `padme`. */
  padding?: EnvelopePadding
}

/** What the SDK hands an encryptor, and what it takes back. Structural, so no SDK import. */
export interface UploadToEncrypt {
  blob: Blob
  contentType: string | undefined
}
export interface EncryptedUpload {
  blob: Blob
  tags: { name: string; value: string }[]
}

/** An `encryptPrivateUpload` for `@seedprotocol/publish`. */
export function createPrivateUploadEncryptor(options: PrivateUploadEncryptorOptions): (upload: UploadToEncrypt) => Promise<EncryptedUpload> {
  const recipients = options.recipients.map((key) => new Uint8Array(key))
  if (recipients.length === 0) throw new EnvelopeError('BAD_RECIPIENT_KEY', 'A private upload needs at least one recipient')
  for (const key of recipients) {
    if (key.length !== XWING_PUBLIC_KEY_LENGTH) {
      throw new EnvelopeError('BAD_RECIPIENT_KEY', `Recipient public key must be ${XWING_PUBLIC_KEY_LENGTH} bytes`)
    }
  }
  if (options.bind && 'envelopeId' in options.bind) {
    throw new EnvelopeError('BAD_BIND', 'envelopeId is chosen per upload; leave it out of bind')
  }
  return async ({ blob, contentType }) => {
    const fileKey = generateFileKey()
    const envelope = await encryptEnvelope({
      fileKey,
      bind: { ...options.bind, envelopeId: generateEnvelopeId() },
      stanzas: await Promise.all(recipients.map((key) => wrapFileKey(fileKey, key))),
      contentType: contentType || 'application/octet-stream',
      body: new Uint8Array(await blob.arrayBuffer()),
      padding: options.padding,
    })
    return { blob: new Blob([envelope as BlobPart]), tags: [{ ...ENVELOPE_FORMAT_TAG }] }
  }
}
