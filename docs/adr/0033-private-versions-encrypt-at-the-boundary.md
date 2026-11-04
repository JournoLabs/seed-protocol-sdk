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
not use "sealed" or "locked" for encryption concepts.

**Envelopes.** Encrypted bytes use the `seed-private/v1` envelope, specified in
`packages/encryption/SPEC.md` with test vectors. The format code lives in `@seedprotocol/encryption`,
which does not depend on the SDK, so a reader can decrypt without it. Each private Version gets a
random content key, always wrapped to the publisher, so the publisher can read their own content
without any outside service.

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

Local rows and files stay plaintext. A synced row whose content is encrypted and whose key this
device doesn't hold is stored with its envelope id and no value, distinct from a draft and from a
revoked row.

**Privacy is declared per property** with `private: true` in the schema file. Public properties of
the same model are published as today.

**Revocation withholds the future only.** Once a reader has a key, it opens every ciphertext that
key covers, forever. Revoking a key grant stops future keys from being issued and is a policy signal
honest clients respect; publishing a new Version under a new content key is the only way to cut a
reader off from changed content. Product wording describes access to Versions published while the
reader's access was active, never "unpublish" or "revoke access" to past content.

**Entitlement is pluggable.** Who may receive keys is answered by adapters registered against
`isEntitled(policy, address, blockTag)`. Licensing is a separate package that registers its own
adapter; no license terms appear in encryption schemas or APIs.

## Consequences

- Reading a private Version needs the SDK's encryption identity on the device. Without it, the
  Version shows as encrypted with no value, not as missing.
- Encryption hides content, not structure. The uploader address, byte sizes, model type, attester,
  timing, Version count and relation uids stay public.
- Ciphertext needs no server change: the upload API and bundlers forward data items without
  reading them.
- Places that hand a gateway URL straight to the browser (`SeedImage`, `useEnsureLocalImage`,
  `mediaRef` hrefs, feed image URLs) can't show private content and must use local blob URLs for it.
- A new property metadata column is needed for the envelope id, so a migration.
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
