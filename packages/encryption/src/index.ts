export {
  CHUNK_SIZE,
  ENVELOPE_CONTENT_TYPE,
  ENVELOPE_FORMAT,
  ENVELOPE_FORMAT_TAG,
  EnvelopeError,
  FILE_KEY_LENGTH,
  canonicalBind,
  decryptEnvelope,
  encryptEnvelope,
  generateEnvelopeId,
  generateFileKey,
  isEnvelope,
  parseEnvelopeHeader,
} from './envelope'
export type {
  DecryptEnvelopeOptions,
  DecryptedEnvelope,
  EncryptEnvelopeInput,
  EnvelopeBind,
  EnvelopeErrorCode,
  EnvelopeHeader,
  EnvelopePadding,
  Stanza,
} from './envelope'
export {
  XWING_PUBLIC_KEY_LENGTH,
  XWING_SECRET_KEY_LENGTH,
  XWING_STANZA_TYPE,
  generateRecipientKeyPair,
  unwrapFileKey,
  unwrapWithSecretKeys,
  wrapFileKey,
} from './recipient'
export type { RecipientKeyPair } from './recipient'
export { UnknownEntitlementKindError, isEntitled, registerEntitlementAdapter } from './entitlement'
export type { AccessPolicyRef, EntitlementAdapter, EntitlementBlockTag } from './entitlement'
export {
  IDENTITY_SECRET_LENGTH,
  createEncryptionIdentity,
  encryptionIdentityFromSecret,
  encryptionKeyId,
  generateRecoveryPhrase,
  keyBindingMessage,
  recoveryKeyFromPhrase,
  signKeyBinding,
  verifyKeyBinding,
  type KeyBindingTarget,
} from './identity'
export type { EncryptionIdentity } from './identity'
export {
  EOA_SIGNATURE_STANZA_TYPE,
  KEYSTORE_CONTENT_TYPE,
  PASSKEY_PRF_STANZA_TYPE,
  buildKeystoreManifest,
  describeKeystoreManifest,
  eoaSignatureMessage,
  eoaSignatureStanza,
  generateEoaSignatureSalt,
  generatePasskeySalt,
  openKeystoreManifest,
  passkeyStanza,
  recoveryStanza,
} from './keystore'
export type { KeystoreAuthenticator, KeystoreUnlock, PasskeyPrfEvaluator, PasskeyPrfRequest } from './keystore'
export { enrollPasskey, passkeyPrf } from './passkey'
export type { PasskeyOptions } from './passkey'
export { forgetIdentityOnDevice, listIdentitiesOnDevice, loadIdentityFromDevice, saveIdentityOnDevice } from './deviceStore'
export { createPrivateUploadEncryptor } from './uploadEncryptor'
export type { EncryptedUpload, PrivateUploadEncryptorOptions, UploadToEncrypt } from './uploadEncryptor'
export { createEnvelopeDecryptor } from './envelopeDecryptor'
export type { EnvelopeOpener } from './envelopeDecryptor'
