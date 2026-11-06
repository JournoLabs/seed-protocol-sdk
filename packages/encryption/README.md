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

// Elsewhere, with the manifest fetched by the key id from the registration attestation:
const unlocked = await openKeystoreManifest(manifest, { passkey: passkeyPrf() }, { expectKeyId })
```
