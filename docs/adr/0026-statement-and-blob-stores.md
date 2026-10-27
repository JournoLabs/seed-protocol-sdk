# 0026. Seeds publish through a statement store and a blob store; EAS and Arweave are the first

- **Status:** Proposed
- **Date:** 2026-10-27
- **Scope:** `@seedprotocol/sdk` (publish payload, sync, uid checks, ownership),
  `@seedprotocol/publish` (attestation strategies, uploads, verification), `@seedprotocol/eas`,
  `@seedprotocol/arweave`, `@seedprotocol/query` (`QueryDataSource`)

## Context

Seed uses EAS and Arweave for four jobs: signing statements (attester = publisher wallet),
ordering them (chain inclusion), finding them (the EAS GraphQL indexer), and keeping blobs
(Arweave). We want other backends as additional adapters: an org's own database, AT Protocol, a
transparency log, S3-compatible storage. EAS and Arweave stay.

Parts of the code already abstract this:

- `QueryDataSource` (`query/src/source/types.ts`) is a pluggable read interface with an EAS
  GraphQL implementation and a local SQLite one. Its `AttestationLike` rows (`id`, `refUID`,
  `schemaId`, `attester`, `timeCreated`, `decodedDataJson`, `revoked`) are EAS-named but carry
  nothing EAS-only.
- Publish chooses between two attestation strategies, `directEas` and `multiPublish`
  (`publish/src/services/publish/index.ts`, `actors/checking.ts`).
- `applyPropertyAttestationUidsFromPublish` takes `{schemaUid, attestationUid, propertyName,
  metadataLocalId, value}` pairs, and `verifyAttestations` takes an injected `getProperties`.
- `getPublishUploads` computes a SHA-256 of every upload.

The rest assumes EAS:

- **Uids.** `isValidEasAttestationUid` and `isPlaceholderUid` (`eas/src/easUid.ts`) are used in 20
  SDK files. Most ask "is this row published", not "is this an EAS uid". `getPublishPayload`
  (`isUidRef`) and `storageValue/resolve.ts` test for `0x` + 64 hex directly. The local database
  holds attestations from one chain, recorded in `app_state` under `easChainId`
  (`helpers/localDbChain.ts`).
- **Encoding.** `getPublishPayload` encodes values with `SchemaEncoder` while it builds the payload:
  relations and lists as `bytes32`, Dates as `uint256` seconds, Numbers as decimal strings (ADR
  0010). `resolvePublishPayloadValues` re-encodes refs once Seed uids are known.
- **Schemas.** A Seed's schema is `bytes32 <easName(model)>`, a property's is
  `<easType> <easName(property)>` with no model in it, and the Version schema is the fixed
  `bytes32 version` (ADR 0008, `ensureEasSchemas.ts`). Rows store the resulting EAS schema UIDs in
  `schema_uid`.
- **Publishers.** `publisher` holds the attester's EVM address. Ownership compares it to the
  client's configured addresses (`helpers/ownership.ts`).
- **Sync.** `syncDbWithEas.ts` calls `eas/src/api.ts` directly instead of `QueryDataSource`.

A second backend needs answers to four questions before any adapter code: what a uid looks like,
who the publisher is, what bytes get signed, and how schemas are identified outside EAS.

## Decision

### The two seams

Publish builds backend-neutral statements and hands them to a **statement store**. Blobs go to a
**blob store**. EAS is a statement store and Arweave a blob store; both keep their current
behaviour.

```ts
type SeedStatement = {
  kind: 'seed' | 'version' | 'property'
  localId: string                    // seeds / versions / metadata local_id
  schema: SchemaKey                  // see "Schema identity"
  ref?: StatementRef                 // version -> seed, property -> version
  value: StatementValue              // see "Canonical statement bytes"
  revocable: boolean
}
type StatementRef = { localId: string; uid?: StatementUid }

interface StatementStore {
  readonly id: string                // 'eas', 'sql', 'atproto', ...
  readonly signs: boolean            // false when the store itself is the trust anchor
  ensureSchemas(keys: SchemaKey[]): Promise<Map<SchemaKey, string>>   // key -> schema_uid
  publish(batch: SeedStatement[], ctx: PublishContext): Promise<PublishReceipt>
  revoke(uids: StatementUid[], ctx: PublishContext): Promise<void>
  read: QueryDataSource
}
type PublishReceipt = {
  uids: Map<string, StatementUid>    // localId -> uid
  publisher: PublisherId
  createdAtMs: number
  raw?: unknown                      // stored in attestation_raw
}

interface BlobStore {
  readonly id: string                // 'arweave', 's3', ...
  put(uploads: PublishUploadData[], ctx: PublishContext): Promise<BlobRef[]>
  exists(refs: BlobRef[]): Promise<boolean[]>
  get(ref: BlobRef, opts?: { signal?: AbortSignal }): Promise<Uint8Array>
  url(ref: BlobRef): string | null
}
type BlobRef = { id: string; sha256: string }
```

A Seed's statements all live in one statement store: its Versions and properties go to the store
that holds the Seed statement. Mirroring a Seed to a second store is out of scope.

### Uid format

`StatementUid` is an opaque string.

- A bare `0x` + 64 hex uid is an EAS attestation uid on the chain recorded under `easChainId`.
  Existing rows keep their uids; nothing is rewritten.
- Every other store writes a URI whose scheme names the store: `sql:<id>`, `at://<did>/<nsid>/<rkey>`,
  `tlog:<origin>/<index>`. A store's `id` and its uid scheme are registered together, and a uid with
  an unregistered scheme is an error, not a placeholder.
- Placeholders do not change: NULL, `''`, `'NULL'` and `ZERO_BYTES32`. `attestedUidSql` and the
  partial unique indexes on `seeds.uid` and `versions.uid` stay as they are.
- `isPublishedUid(value)` (`!isPlaceholderUid(value)`) replaces `isValidEasAttestationUid` at call
  sites that only ask whether a row is published. `isValidEasAttestationUid` stays for EAS-only
  code: encoding, the EAS adapter and EAS reads.
- A relation or list value can only reference Seeds in the same statement store. EAS stores refs
  as `bytes32` and can't hold another store's uid. Publish fails with an error naming the property
  when a relation points outside the store.

### Publisher identity

`publisher` holds a `PublisherId`:

- A bare `0x` + 40 hex value is an EVM address, as today, normalized by `normalizeHexAddress`. It
  stays chain-independent, the same as ownership checks treat it now.
- Any other publisher is a DID: `did:key`, `did:web` or `did:plc`.
- The client's owned and watched address lists accept DIDs beside EVM addresses, and
  `isSeedRowOwned` compares by the same rule.
- A store with `signs: false` (an org database) still records a publisher, normally a `did:web`
  under the org's domain. Readers can see from the store's `signs` flag that no signature backs it.

### Canonical statement bytes

Stores that sign or log statements themselves (every store except EAS) sign the
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) JCS serialization of the `SeedStatement` with
`ref.uid` resolved, `localId` removed, and `publisher` and `createdAtMs` added. Values by internal
data type:

| Data type | Statement value |
|---|---|
| Text, Number | string (Number stays a decimal string, as ADR 0010) |
| Boolean | boolean |
| Date | integer seconds, as on EAS |
| Relation, Image, File, Html (the Seed ref) | uid string |
| List | array of uid strings |
| Json | the JSON value |
| `storage_transaction_id` | `BlobRef` |

The statement's SHA-256 over these bytes is its content hash. A store without native ids (a log,
a SQL table) may use it to build its uid. Signatures are Ed25519 for DID publishers and EIP-191
secp256k1 for EVM-address publishers. `attestation_raw` stores `{ alg, sig, publisher }` beside the
store's own receipt.

EAS does not use these bytes. Its encoding stays the ABI encoding in `SchemaEncoder`, now built
from `SeedStatement` by the EAS adapter instead of inside `getPublishPayload`.

A bare 43-character base64url `BlobRef.id` is an Arweave transaction id, as today. Other blob
stores write a URI (`s3://<bucket>/<key>`, `at-blob:<did>/<cid>`). Whichever blob store wrote it,
the `storage_transaction_id` value is `BlobRef.id`.

### Schema identity

A `SchemaKey` follows the EAS schemas one-to-one, with names normalized by `easName()`
(ADR 0008), so both name rules stay the same:

- `seed:<model>` for a Seed statement
- `version` for a Version statement
- `property:<property>:<dataType>` for a property statement, using Seed's internal data type
  (`Text`, `Image`, ...), not the EAS type

`ensureSchemas` maps each key to the store's own schema id, which goes in `schema_uid`:

- EAS: the schema UID it registers today
- AT Protocol: a Lexicon NSID
- SQL: the key itself

Query and sync filter on `schema_uid` as they do now, and resolve keys through the store that wrote
the row.

## Consequences

- Existing EAS-published data, uids and schema UIDs do not change, and EAS publish keeps its
  encoding.
- First implementation steps:
  1. Route `syncDbWithEas.ts` through `QueryDataSource`.
  2. Move `SchemaEncoder` work out of `getPublishPayload` into the EAS adapter.
  3. Add a third attestation strategy that calls `StatementStore.publish`.
  4. Wrap `uploadViaBundler` and the gateway reads as the Arweave `BlobStore`.
- Code that tests for `0x` + 64 hex to mean "published" has to switch to `isPublishedUid`.
  `storageValue/resolve.ts` and `isUidRef` in `getPublishPayload` are the direct regex checks.
- Mixing stores inside one Seed graph isn't possible: a relation can't cross stores. An app that
  uses two stores keeps them as separate graphs.
- Ownership, the owned and watched address config, and `queryBySchema`'s `attesters` filter accept
  DIDs. Code that lowercases every publisher as hex has to leave DIDs alone.
- Statements in a store with `signs: false` are only as trustworthy as that database. Readers
  that require signatures filter on the store.
- Where the interfaces live is not decided here. Today `sdk` depends on `eas` and `arweave`, so the
  interfaces can't sit in either without a cycle; a small spec package is the likely answer.
  Removing those dependencies is **Breaking** for PermaPress.

## Alternatives considered

- **Prefix every uid, EAS included** (`eas:<chain>:0x...`). Uniform, but it rewrites every
  `uid`, `seed_uid`, `version_uid` and relation value in existing databases, and EAS reads would
  strip the prefix on every comparison. The chain is already pinned per database.
- **A `store` column on `seeds`, `versions` and `metadata`.** It names the store explicitly, but
  needs a migration and can disagree with the uid. A scheme in the uid can't disagree with itself.
- **CAIP-10 for EVM publishers** (`eip155:<chain>:<address>`). Seed treats an address as the same
  publisher on every chain, so the chain id adds a way to mismatch without adding meaning.
- **VC 2.0 Data Integrity with RDF canonicalization as the signed form.** It needs JSON-LD
  contexts and RDF canonicalization in the browser. JCS bytes can still be wrapped as a VC later
  with a JCS-based cryptosuite.
- **dag-cbor as the canonical bytes.** Compact and IPLD-native, but it adds a codec dependency, and
  only the IPFS-family stores would benefit.
- **Per-backend schema keys with no fixed mapping to EAS.** Each store would invent its own names,
  and the same property would have different identities depending on where it was published.
