# @seedprotocol/encryption

Encryption for Seed Protocol private Versions. Not published yet: the package is `private` until
private Versions ship (ADR 0033).

- `encryptEnvelope` / `decryptEnvelope`: the `seed-private/v1` envelope, specified in
  [SPEC.md](SPEC.md). WebCrypto only; no SDK dependency, so a reader can decrypt without the SDK.
- `parseEnvelopeHeader`: the bind values and recipient stanzas, readable without a key.
- `registerEntitlementAdapter` / `isEntitled`: which addresses may receive keys for an access
  policy, answered by an adapter per policy kind.

```ts
import { decryptEnvelope, encryptEnvelope, generateEnvelopeId, generateFileKey } from '@seedprotocol/encryption'

const fileKey = generateFileKey()
const envelope = await encryptEnvelope({
  fileKey,
  bind: { envelopeId: generateEnvelopeId() },
  stanzas: [publisherStanza], // wraps fileKey for the publisher
  contentType: 'text/html',
  body,
})
const { contentType, body: plain } = await decryptEnvelope(envelope, { fileKey })
```

Recipient stanza types (the publisher's wrap, readers' wraps) are not defined yet.
