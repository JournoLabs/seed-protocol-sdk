# @seedprotocol/encryption

Encryption for Seed Protocol private Versions. Not published yet: the package is `private` until
private Versions ship (ADR 0033).

- `encryptEnvelope` / `decryptEnvelope`: the `seed-private/v1` envelope, specified in
  [SPEC.md](SPEC.md). No SDK dependency, so a reader can decrypt without the SDK.
- `parseEnvelopeHeader`: the bind values and recipient stanzas, readable without a key.
- `generateRecipientKeyPair`, `wrapFileKey`, `unwrapFileKey`, `unwrapWithSecretKeys`: the
  `mlkem768x25519` recipient stanza, which seals the file key to an X-Wing (post-quantum hybrid)
  public key with HPKE. X-Wing comes from `@noble/post-quantum`.
- `createEncryptionIdentity`, `encryptionIdentityFromSecret`: a user's identity, one 32-byte secret
  from which the recipient key, an X25519 tag key and the key id are derived.
- `generateRecoveryPhrase`, `recoveryKeyFromPhrase`: a 24-word BIP39 phrase and the recovery key
  derived from it.
- `buildKeystoreManifest`, `openKeystoreManifest`, `describeKeystoreManifest`: the public keystore
  manifest that recovers the identity, with a stanza per authenticator (`recoveryStanza`,
  `passkeyStanza`, `eoaSignatureStanza`). `enrollPasskey` and `passkeyPrf` make the WebAuthn calls.
- `createPrivateUploadEncryptor`: the `encryptPrivateUpload` for `@seedprotocol/publish`, one envelope
  per private upload.
- `createEnvelopeDecryptor`: opens downloaded envelopes for the SDK's `setEnvelopeDecryptor`.
- `saveIdentityOnDevice`, `loadIdentityFromDevice`, `listIdentitiesOnDevice`,
  `forgetIdentityOnDevice`: an unlocked identity kept in IndexedDB under a non-extractable key.
  Any script on the origin can still decrypt it, so don't save one on a shared device.
- `registerEntitlementAdapter` / `isEntitled`: which addresses may receive keys for an access
  policy, answered by an adapter per policy kind.

```ts
import {
  decryptEnvelope,
  encryptEnvelope,
  generateEnvelopeId,
  generateFileKey,
  unwrapWithSecretKeys,
  wrapFileKey,
} from '@seedprotocol/encryption'

const fileKey = generateFileKey()
const envelope = await encryptEnvelope({
  fileKey,
  bind: { envelopeId: generateEnvelopeId() },
  stanzas: [await wrapFileKey(fileKey, publisher.publicKey), await wrapFileKey(fileKey, recovery.publicKey)],
  contentType: 'text/html',
  body,
})
const { contentType, body: plain } = await decryptEnvelope(envelope, {
  unwrap: unwrapWithSecretKeys([publisher.secretKey]),
})
```

Setting up an identity, and unlocking it on another device:

```ts
import {
  buildKeystoreManifest,
  createEncryptionIdentity,
  enrollPasskey,
  generateRecoveryPhrase,
  openKeystoreManifest,
  passkeyPrf,
  recoveryKeyFromPhrase,
  recoveryStanza,
  saveIdentityOnDevice,
} from '@seedprotocol/encryption'

const identity = await createEncryptionIdentity()
const phrase = generateRecoveryPhrase() // show once
const manifest = await buildKeystoreManifest(identity, [
  await recoveryStanza(identity, (await recoveryKeyFromPhrase(phrase)).publicKey),
  await enrollPasskey(identity, { rpName: 'PermaPress', userName: 'reader@example.com' }),
])
await saveIdentityOnDevice(identity)

// Elsewhere: the newest registration from getEncryptionKeysFromEas (@seedprotocol/eas) names the
// manifest's Arweave transaction and the key id.
const unlocked = await openKeystoreManifest(manifest, { passkey: passkeyPrf() }, { expectKeyId: registration.keyId })
```

`registerEncryptionKey` in `@seedprotocol/publish` uploads the manifest and attests the key id and
public keys from the user's account.

Publishing private properties: pass an encryptor wrapping to the account's registered key.

```ts
import { createPrivateUploadEncryptor } from '@seedprotocol/encryption'
import { getEncryptionKeysFromEas } from '@seedprotocol/eas'
import { initPublish } from '@seedprotocol/publish'

const [registration] = await getEncryptionKeysFromEas({ attester: account })
initPublish({
  // ...
  encryptPrivateUpload: createPrivateUploadEncryptor({
    recipients: [registration.recipientKey],
    bind: { chainId: '11155420', publisher: account },
  }),
})
```

Only Html, Json, File, Image and ItemStorage Text properties can be `private: true`; their uploads
are encrypted, and titles, relations and other scalars stay public.

Reading private Versions on a device where the identity is unlocked: register a decryptor in every
tab, then open what earlier downloads kept.

```ts
import { createEnvelopeDecryptor } from '@seedprotocol/encryption'
import { openAllEncryptedDownloads, setEnvelopeDecryptor } from '@seedprotocol/sdk'

setEnvelopeDecryptor(createEnvelopeDecryptor([unlocked]))
await openAllEncryptedDownloads()
```

Until then, a private Image, File or Html value reads as `valueStatus: 'encrypted'`. Don't register a
decrypting Arweave read transform in a process that builds public feeds.
