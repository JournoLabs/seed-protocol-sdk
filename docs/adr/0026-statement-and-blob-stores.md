# 0026. Seeds publish through statement and blob stores, and link across stores through proxy Seeds

- **Status:** Proposed
- **Date:** 2026-10-27
- **Scope:** `@seedprotocol/sdk` (publish payload, sync, uid checks, ownership, relations),
  `@seedprotocol/publish` (attestation strategies, uploads, verification), `@seedprotocol/eas`,
  `@seedprotocol/arweave`, `@seedprotocol/query` (`QueryDataSource`)

## Context

Seed uses EAS and Arweave for four jobs: signing statements (attester = publisher wallet),
ordering them (chain inclusion), finding them (the EAS GraphQL indexer), and keeping blobs
(Arweave). We want other backends as additional adapters: an org's own database, AT Protocol, a
transparency log, S3-compatible storage. EAS and Arweave stay. We also want a Seed published in
one place to be usable in another: a Seed on OP related from a Seed on Base, or an EAS Seed
related from an org's database.

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

The rest assumes EAS on one chain:

- **Uids.** `isValidEasAttestationUid` and `isPlaceholderUid` (`eas/src/easUid.ts`) are used in 20
  SDK files. Most ask "is this row published", not "is this an EAS uid". `getPublishPayload`
  (`isUidRef`) and `storageValue/resolve.ts` test for `0x` + 64 hex directly. The local database
  holds attestations from one chain, recorded in `app_state` under `easChainId`, and throws when it
  holds data from another (`helpers/localDbChain.ts`).
- **Encoding.** `getPublishPayload` encodes values with `SchemaEncoder` while it builds the payload:
  relations and lists as `bytes32`, Dates as `uint256` seconds, Numbers as decimal strings (ADR
  0010). `resolvePublishPayloadValues` re-encodes refs once Seed uids are known.
- **Relations.** A relation or list value is a `bytes32` Seed uid, so it can only name a Seed
  attested on the same chain.
- **Schemas.** A Seed's schema is `bytes32 <easName(model)>`, a property's is
  `<easType> <easName(property)>` with no model in it, and the Version schema is the fixed
  `bytes32 version` (ADR 0008, `ensureEasSchemas.ts`). Rows store the resulting EAS schema UIDs in
  `schema_uid`. Those UIDs are the same on every chain while the schemas have no resolver.
- **Publishers.** `publisher` holds the attester's EVM address. Ownership compares it to the
  client's configured addresses (`helpers/ownership.ts`), the same address on every chain.
- **Sync.** `syncDbWithEas.ts` calls `eas/src/api.ts` directly instead of `QueryDataSource`.

A second backend needs answers to five questions before any adapter code: what a uid looks like,
who the publisher is, what bytes get signed, how schemas are identified outside EAS, and how a
Seed reaches a store it wasn't published to.

## Decision

### The two seams

Publish builds backend-neutral statements and hands them to a **statement store**. Blobs go to a
**blob store**. EAS is a statement store and Arweave a blob store; both keep their current
behaviour. Each EAS chain is a separate statement store.

```ts
type SeedStatement = {
  kind: 'seed' | 'version' | 'property' | 'link'
  localId: string                    // seeds / versions / metadata local_id
  schema: SchemaKey                  // see "Schema identity"
  ref?: StatementRef                 // version -> seed, property -> version, link -> seed or version
  value: StatementValue              // see "Canonical statement bytes"
  revocable: boolean
}
type StatementRef = { localId: string; uid?: StatementUid }

interface StatementStore {
  readonly id: string                // 'eas:8453', 'sql', 'atproto', ...
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

A Seed has one **home store**, the store its Seed statement was first published to. Its Versions
and properties are published there. It reaches other stores through proxy Seeds (below).

### Uid format

`StatementUid` is an opaque string.

- A bare `0x` + 64 hex uid is an EAS attestation uid on the chain recorded under `easChainId`.
  Existing rows keep their uids; nothing is rewritten.
- Every other store writes a URI whose scheme names the store: `eas:<chainId>:0x…` for an EAS
  chain other than the recorded one, `sql:<id>`, `at://<did>/<nsid>/<rkey>`,
  `tlog:<origin>/<index>`. A store's `id` and its uid scheme are registered together, and a uid with
  an unregistered scheme is an error, not a placeholder. The local database accepts prefixed rows
  from any registered store; the `easChainId` check still refuses bare uids from another chain.
- Where a uid leaves its store (a link value, an export), it is written **qualified**: a bare EAS
  uid becomes `eas:<easChainId>:0x…`. Prefixed uids are already qualified.
- Placeholders do not change: NULL, `''`, `'NULL'` and `ZERO_BYTES32`. `attestedUidSql` and the
  partial unique indexes on `seeds.uid` and `versions.uid` stay as they are.
- `isPublishedUid(value)` (`!isPlaceholderUid(value)`) replaces `isValidEasAttestationUid` at call
  sites that only ask whether a row is published. `isValidEasAttestationUid` stays for EAS-only
  code: encoding, the EAS adapter and EAS reads.

### Proxy Seeds and link statements

A **proxy Seed** is a Seed in another store that stands for a home Seed. It has the same Model and
a `link` statement whose value names the home Seed's qualified uid. Readers recognise a proxy by
its link; nothing else about it differs from a Seed.

A link statement:

- `ref` is the local Seed or Version that carries the link.
- `value` is `{ target: <qualified uid>, mode: 'pointer' | 'replica' }`.
- On EAS its schema is `string seed_link_target, bool seed_link_replica`, with `refUID` set to the
  carrying Seed or Version. The target is a `string`, so it can name any store.

There are two modes:

- **Pointer.** The proxy has a link and no Versions of its own. Readers follow the link and read
  Versions from the home store. It's cheap but needs the home store to be reachable.
- **Replica.** The proxy also carries copies of the home Seed's Versions. Each copied Version has a
  link statement to the home Version it came from, and its properties hold the same values and
  `BlobRef`s. It still reads when the home store is unreachable.

A link is **two-way** when the home Seed also carries a link to the proxy. A two-way link counts as
the same Seed when both links have the same publisher, or publishers bound by alias statements
(below). Any other link, including a one-way link by a third party, is a claim by its attester:
readers show it as one and filter it by attester like `queryBySchema`'s `attesters` filter.

Relations cross stores through proxies. When a property relates to a Seed in another store,
publish creates or reuses a pointer proxy of that Seed in the relating Seed's home store and
points the relation at the proxy. On EAS the relation stays a `bytes32` ref on its own chain, and
the proxy's link carries the hop. Publish reuses an existing proxy only when the current publisher
published it, or the link from it is two-way. The proxy is published in the same batch as the
relating Seed.

When Versions disagree, the home store's Versions win. A replica that is behind its home is
stale, not conflicting. When a home Seed is revoked, publish revokes the proxies the same
publisher created, and readers treat a link whose other end is revoked as one-way.

`resolveSeed(uid)` follows two-way links across every registered store's `QueryDataSource`. It
returns the home Seed's Versions, merged with replica Versions only when the home store can't be
reached.

### Publisher identity

`publisher` holds a `PublisherId`:

- A bare `0x` + 40 hex value is an EVM address, as today, normalized by `normalizeHexAddress`.
  Seed treats it as the same publisher on every chain.
- Any other publisher is a DID: `did:key`, `did:web` or `did:plc`.
- [`did:pkh`](https://github.com/w3c-ccg/did-pkh/blob/main/did-pkh-method-draft.md) is accepted as
  input, and an `eip155` one is stored as its bare address. did:pkh requires a CAIP-10 account, so
  it always carries a chain id, which Seed's chain-independent publishers don't have. Converting
  every row would change nothing in meaning.
- The client's owned and watched address lists accept DIDs and `did:pkh` beside EVM addresses,
  and `isSeedRowOwned` compares by the same rule.
- An **alias statement** binds two publishers: publisher A attests "A is also B" and B attests "B
  is also A", each in a store the other side can read. Schema key `alias`, value the other
  `PublisherId`. A one-sided alias binds nothing.
- A smart account's address is the same on two chains only when its factory and salt are. A
  publisher whose smart-account addresses differ between chains needs an alias pair before its
  cross-chain links count as two-way.
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
| Relation, Image, File, Html (the Seed ref) | uid string in the same store (a proxy when the target is elsewhere) |
| List | array of uid strings, same rule |
| Json | the JSON value |
| `storage_transaction_id` | `BlobRef` |
| link | `{ target, mode }` |
| alias | `PublisherId` |

The statement's SHA-256 over these bytes is its content hash. A store without native ids (a log,
a SQL table) may use it to build its uid. Signatures are Ed25519 for DID publishers and EIP-191
secp256k1 for EVM-address publishers; a smart-account publisher's signature is checked with
ERC-1271 on a chain where the account is deployed. `attestation_raw` stores `{ alg, sig, publisher }`
beside the store's own receipt.

EAS does not use these bytes. Its encoding stays the ABI encoding in `SchemaEncoder`, now built
from `SeedStatement` by the EAS adapter instead of inside `getPublishPayload`.

A bare 43-character base64url `BlobRef.id` is an Arweave transaction id, as today. Other blob
stores write a URI (`s3://<bucket>/<key>`, `at-blob:<did>/<cid>`). Whichever blob store wrote it,
the `storage_transaction_id` value is `BlobRef.id`. A replica keeps the home Version's `BlobRef`s
and doesn't copy the bytes.

### Schema identity

A `SchemaKey` follows the EAS schemas one-to-one, with names normalized by `easName()`
(ADR 0008), so both name rules stay the same:

- `seed:<model>` for a Seed statement
- `version` for a Version statement
- `property:<property>:<dataType>` for a property statement, using Seed's internal data type
  (`Text`, `Image`, ...), not the EAS type
- `link` and `alias` for link and alias statements

`ensureSchemas` maps each key to the store's own schema id, which goes in `schema_uid`:

- EAS: the schema UID it registers today. With no resolver, the UID is the same on every chain.
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
  5. Register the `link` and `alias` schemas on EAS and add proxy creation to publish.
  6. Add `resolveSeed` across stores.
- A second EAS chain is the first cross-store case and needs no new backend: Base and OP Seeds can
  relate through proxies as soon as steps 5 and 6 exist.
- Code that tests for `0x` + 64 hex to mean "published" has to switch to `isPublishedUid`.
  `storageValue/resolve.ts` and `isUidRef` in `getPublishPayload` are the direct regex checks.
- A cross-store relation costs a proxy Seed and a link in the relating store, and on EAS that's two
  more attestations on that chain. Making it two-way costs a link in the home store too, published
  by the home Seed's publisher. Publish can only add that link when the same wallet or key controls
  both stores.
- Readers have to decide what a one-way link means. The SDK shows it as a claim and doesn't merge
  its Versions.
- Replicas go stale. Tooling that refreshes them is a follow-up; until then a replica shows the
  Versions it was published with.
- Ownership, the owned and watched address config, and `queryBySchema`'s `attesters` filter accept
  DIDs and `did:pkh`. Code that lowercases every publisher as hex has to leave DIDs alone.
- Statements in a store with `signs: false` are only as trustworthy as that database. Readers
  that require signatures filter on the store.
- Where the interfaces live is not decided here. Today `sdk` depends on `eas` and `arweave`, so the
  interfaces can't sit in either without a cycle; a small spec package is the likely answer.
  Removing those dependencies is **Breaking** for PermaPress.

## Alternatives considered

- **Relations stay inside one store** (this ADR's first draft). Simpler, but a Seed couldn't relate
  to anything published elsewhere, including the same publisher's Seeds on another chain.
- **Relations hold qualified uids directly.** The relating Seed could name the target without a
  proxy, but an EAS relation is `bytes32` and can't hold one, and readers of the relating store
  would see a target they can't list or query.
- **Cross-chain messaging** (a bridge contract that proves the other end on-chain). It verifies on
  the chain, at the cost of bridge fees and trust in the bridge, and it only covers chains. Readers
  can check a two-way link themselves by reading both stores.
- **Prefix every uid, EAS included** (`eas:<chain>:0x...`). Uniform, but it rewrites every
  `uid`, `seed_uid`, `version_uid` and relation value in existing databases, and EAS reads would
  strip the prefix on every comparison. The chain is already pinned per database, so the prefix is
  used only where a uid leaves its store.
- **A `store` column on `seeds`, `versions` and `metadata`.** It names the store explicitly, but
  needs a migration and can disagree with the uid. A scheme in the uid can't disagree with itself.
- **`did:pkh` for every publisher.** One identifier type, but did:pkh requires a chain id, so the
  same EOA would be a different DID on each chain and every existing row would be converted. It is
  accepted as input instead.
- **CAIP-10 for EVM publishers** (`eip155:<chain>:<address>`). Rejected for the same reason as
  did:pkh.
- **VC 2.0 Data Integrity with RDF canonicalization as the signed form.** It needs JSON-LD
  contexts and RDF canonicalization in the browser. JCS bytes can still be wrapped as a VC later
  with a JCS-based cryptosuite.
- **dag-cbor as the canonical bytes.** Compact and IPLD-native, but it adds a codec dependency, and
  only the IPFS-family stores would benefit.
- **Per-backend schema keys with no fixed mapping to EAS.** Each store would invent its own names,
  and the same property would have different identities depending on where it was published.
