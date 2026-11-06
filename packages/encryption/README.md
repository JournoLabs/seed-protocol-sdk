# @seedprotocol/encryption

Encryption for Seed Protocol private Versions. Not published yet: the package is `private` until
private Versions ship (ADR 0033).

- `encryptEnvelope` / `decryptEnvelope`: the `seed-private/v1` envelope, specified in
  [SPEC.md](SPEC.md). No SDK dependency, so a reader can decrypt without the SDK.
- `parseEnvelopeHeader`: the bind values and recipient stanzas, readable without a key.
- `generateRecipientKeyPair`, `wrapFileKey`, `unwrapFileKey`, `unwrapWithSecretKeys`: the
  `mlkem768x25519` recipient stanza, which seals the file key to an X-Wing (post-quantum hybrid)
  public key with HPKE. X-Wing comes from `@noble/post-quantum`, the package's one dependency.
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
