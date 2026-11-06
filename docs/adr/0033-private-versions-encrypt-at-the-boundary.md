# 0033. Private Versions encrypt at the publish and read boundaries; access can only be withheld going forward

- **Status:** Proposed
- **Date:** 2026-11-04
- **Scope:** new `@seedprotocol/encryption`; `@seedprotocol/sdk` (upload builder, EAS sync, file
  downloads, schema files); `@seedprotocol/arweave` (content reads); `@seedprotocol/query`
  (rich-text hydration); `@seedprotocol/react` (image URLs)

## Context

Users want to publish content to EAS and Arweave that only chosen people can read: themselves,
named readers or collaborators, buyers, or subscribers. Both stores are permanent and public.
Anything uploaded stays retrievable, and an attestation can be revoked but not removed.

"Draft" already means one thing in the code: a seed or Version that is saved locally and has never
been attested (`isLocalUnsealedDraft` in `helpers/ownership.ts`, `status: 'draft'` from
`getSeedPublishState`, the `draft` node in `getPublishGraph`). The code calls an attested row
"sealed", and ADR 0023 proposes sealing a Version against amendment. Encrypted content needs names
that don't collide with either.

Everything above SQLite (`Item`, hooks, live queries, the change feed, OPFS files) works on
plaintext, and local storage is not encrypted today.

## Decision

**Terms.** A **draft** is local and unattested, and is never encrypted. A **private Version** is an
attested Version whose private property values are encrypted before they leave the device. An
encrypted Version shared with readers or collaborators is still a private Version. New code does
not use "sealed" or "locked" for encryption concepts: a synced row this device has no key for is
described as "encrypted, no key on this device". If private scalars or an envelope attestation are
added later, they are named `encrypted_content` and `seedprotocol.envelope`.

**Envelopes.** Encrypted bytes use the `seed-private/v1` envelope, specified in
`packages/encryption/SPEC.md` with test vectors. The format code lives in `@seedprotocol/encryption`,
which does not depend on the SDK, so a reader can decrypt without it. Each private upload gets its
own random file key and envelope id, and the key is always wrapped to the publisher, so the
publisher can read their own content without any outside service.

Key wraps are post-quantum hybrid from the start, because ciphertext on Arweave stays readable to
anyone who later breaks the wrap. The `mlkem768x25519` stanza seals the file key with HPKE to an
X-Wing key (ML-KEM-768 plus X25519), following age's recipient of the same name. X-Wing comes from
`@noble/post-quantum`; the HPKE key schedule and AES-256-GCM use WebCrypto.

**Identity and keystore.** A user's encryption identity is one random 32-byte secret; the recipient
key, an X25519 tag key and the key id are derived from it. The secret is recovered from a public
keystore manifest, itself a `seed-private/v1` envelope, with one stanza per authenticator: a
recovery key derived from a 24-word phrase, a passkey's WebAuthn PRF output, or an EOA's
deterministic signature. The manifest's file key derives from the identity, so any device holding
the identity can publish a revised manifest that adds an authenticator without the others present.
Removing an authenticator doesn't revoke it, because old manifests stay on Arweave; that takes a new
identity. A device may keep the unlocked secret in IndexedDB under a non-extractable AES-GCM key.
That stops the raw secret being copied out of the browser's files, not a script on the same origin.

**Registration.** An account publishes its key with an attestation under
`ENCRYPTION_KEY_SCHEMA_DEF` (`seedprotocol.encryptionKey`):

```
bytes32 key_id,string suite,bytes recipient_key,bytes tag_key,bytes32 keystore_tx
```

It has no `refUID`. `suite` is `seed-private/v1`, the public keys are stored in full so anyone can
wrap to them from the attestation alone, and `keystore_tx` is the manifest's Arweave transaction.
The schema is revocable with the zero resolver, so its UID is the same on every chain, and it is
registered once per chain by a wallet that can call SchemaRegistry. The attester is the account:
the wallet's transactions must come from the account itself, so a ManagedAccount attests through a
UserOp calling EAS directly, not through `multiPublish`. Session keys never register keys, since a
leaked one could otherwise redirect every future wrap. Registering again, with a new identity or a
revised manifest, adds an attestation, and readers take the newest live one; revoked ones still name
the manifests that open older Versions. A reader checks the key id against the public keys before
wrapping to them.

**Boundaries.** The SDK encrypts in exactly one place on the way out and decrypts at a fixed set of
seams on the way in:

- Out: `buildPublishUploadData` (`db/read/getPublishUploads.ts`), after the plaintext MIME type is
  known and before the upload is hashed and tagged, so `Content-SHA-256` is the hash of the
  ciphertext.
- In: the Arweave content read transform (`@seedprotocol/arweave`) and the download worker's
  `transformDownloadedContent`. Attestation values need no decrypt step: a private Version's
  private values travel in one encrypted storage seed, and the attestation holds its pointer.
  Bytes that are still an envelope after these steps (no key on the device) are never decoded as
  text or sniffed as media: downloads keep them in `encrypted/`, and text reads return nothing.

Local rows and files stay plaintext. The download worker keeps an envelope whole at
`encrypted/<txId>`, and the tab that downloaded it opens it with the decryptor the app registered
(`setEnvelopeDecryptor`), writing the plaintext where a plain download would have gone; a worker
can't receive a function, and keys stay out of it. A value whose envelope is kept but not opened has
`valueStatus: 'encrypted'`, distinct from a draft, from a missing file and from a revoked row. That
state comes from the kept file, so no metadata column holds the envelope id yet; one can be added if
something needs the state without the download.

The SDK registers no decrypting Arweave read transform. Feed generation hydrates bodies through that
transform, so a process that registered one and built public feeds would publish private bodies.
Html values fall back to the downloaded file, which the decryptor opens.

**Envelopes are padded by default.** The content frame records the body length and is zero-padded
to its PADMÉ length, so an envelope's size shows a size class (at most 12% extra bytes) rather than
the exact length. A publish can turn padding off.

**Privacy is declared per property** with `private: true` in the schema file, and only on
properties whose values are uploaded: Html, Json, File, Image and ItemStorage Text. Their
attestations hold a pointer to the upload, so encrypting the upload is enough. Scalars and relations
are attested as values, so schema files refuse the flag on them and a publish refuses to attest a
private one from a model defined in code; a value that must be private goes in a private Json
property. A model's ItemStorage properties share one composite upload, so they are all private or
all public. An image embedded in a private Html property is encrypted with it. Public properties of
the same model are published as today.

**Publish encrypts through an app-supplied encryptor.** `@seedprotocol/publish` can't depend on
`@seedprotocol/encryption` at runtime while it is unpublished, so the app passes
`createPrivateUploadEncryptor` as `encryptPrivateUpload`. It needs only recipient public keys, from
the registration attestation, so a session key can publish a private Version. A private upload with
no encryptor fails the publish before anything is uploaded.

**No envelope attestation or per-upload recovery wrap.** The publisher's storage transaction
attestation already names each ciphertext's Arweave transaction, whose id commits to its bytes, so
an extra attestation would add a schema and gas without adding a guarantee. The keystore manifest's
recovery stanza recovers the identity every upload is wrapped to, so a second wrap per upload would
only add about 1.2 KB. Either can be added later without changing what is already published.

**Revocation withholds the future only.** Once a reader has a key, it opens every ciphertext that
key covers, forever. Revoking a key grant stops future keys from being issued and is a policy signal
honest clients respect; publishing a new Version under a new content key is the only way to cut a
reader off from changed content. Product wording describes access to Versions published while the
reader's access was active, never "unpublish" or "revoke access" to past content.

**Encryption keys are registered by the user.** The `seedprotocol.encryptionKey` attestation comes
from the user's account (directly, by EOA delegation, or as a sponsored UserOp), never from an
automation session key. A leaked session key could otherwise point every future wrap at an
attacker's key. A session key that publishes a private Version wraps to the key already registered.

**Collaborators re-wrap per editor.** An editor publishing a new Version wraps its file key to every
recipient, reading the recipient list from the Seed's access policy or key grants rather than its
own local state, and always includes the publisher. A shared policy key is left to subscriptions,
where per-epoch keys already play that role.

**Entitlement is pluggable.** Who may receive keys is answered by adapters registered against
`isEntitled(policy, address, blockTag)`. Licensing is a separate package that registers its own
adapter; no license terms appear in encryption schemas or APIs.

## Consequences

- Reading a private Version needs the SDK's encryption identity on the device. Without it, the
  Version shows as encrypted with no value, not as missing.
- Encryption hides content, not structure. The uploader address, byte sizes, model type, attester,
  timing, Version count and relation uids stay public.
- Padding adds up to 12% to a private upload's size, which Arweave cost estimates must include.
- Ciphertext needs no server change: the upload API and bundlers forward data items without
  reading them.
- Places that hand a gateway URL straight to the browser (`SeedImage`, `useEnsureLocalImage`,
  `mediaRef` hrefs, feed image URLs) can't show private content and must use local blob URLs for it.
- `@seedprotocol/encryption` stays `private` in its package.json until private Versions ship, so it
  is not part of releases before then.

## Alternatives considered

- **Encrypting local storage too.** Every layer above SQLite would need keys, and the multi-tab
  coordination would have to share them. Device storage is the user's; the threat is the public
  stores.
- **Threshold networks (Lit, TACo, Seal) as the key path.** Lit Naga and TACo went dark in 2026,
  and ciphertext on Arweave outlives any such service. They may come later as optional gates on top
  of the publisher wrap.
- **Calling author-only encrypted Versions "private drafts".** That would give "draft" two meanings,
  one of them attested.
- **Format code inside the SDK.** A reader would need the whole SDK to decrypt, and the format would
  be harder to keep independent of SDK refactors.
