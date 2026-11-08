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
  from which the recipient key, an X25519 tag key, an Ed25519 binding key and the key id are
  derived.
- `signKeyBinding`, `verifyKeyBinding`: the binding key's signature that the identity belongs to an
  account on a chain, which the account's registration carries.
- `generateRecoveryPhrase`, `recoveryKeyFromPhrase`: a 24-word BIP39 phrase and the recovery key
  derived from it.
- `buildKeystoreManifest`, `openKeystoreManifest`, `describeKeystoreManifest`: the public keystore
  manifest that recovers the identity, with a stanza per authenticator (`recoveryStanza`,
  `passkeyStanza`, `eoaSignatureStanza`). `enrollPasskey` and `passkeyPrf` make the WebAuthn calls.
  Use a passkey and the recovery phrase. `eoaSignatureStanza` lets a wallet signature unlock the
  identity instead, which means anyone with the wallet's key can read every private Version; it
  needs `acceptWalletKeyRisk: true`, so offer it only as an option the user picks.
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

// Elsewhere: the registration from getVerifiedEncryptionKey (@seedprotocol/publish) names the
// manifest's Arweave transaction and the key id.
const unlocked = await openKeystoreManifest(manifest, { passkey: passkeyPrf() }, { expectKeyId: registration.keyId })
```

`registerEncryptionKey` in `@seedprotocol/publish` uploads the manifest and attests the key id,
public keys and binding signature from the user's account, then revokes the account's earlier
registrations.

```ts
import { signKeyBinding } from '@seedprotocol/encryption'
import { registerEncryptionKey } from '@seedprotocol/publish'

await registerEncryptionKey(
  {
    keyId: identity.keyId,
    recipientKey: identity.recipient.publicKey,
    tagKey: identity.tagKey.publicKey,
    bindingKey: identity.bindingKey.publicKey,
    bindingSignature: signKeyBinding(identity, { account, chainId: 11155420 }),
    keystoreManifest: manifest,
  },
  { account },
)
```

Publishing private properties: pass an encryptor wrapping to the account's registered key.

```ts
import { createPrivateUploadEncryptor } from '@seedprotocol/encryption'
import { getVerifiedEncryptionKey, initPublish } from '@seedprotocol/publish'

// The newest registration the indexer lists that EAS on chain confirms. Undefined when none is.
const registration = await getVerifiedEncryptionKey({ account })
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
