# Changelog

All notable changes to this package are documented in this file.

## 0.8.2 (2026-11-09)

- **Breaking:** `exportArchive`, `verifyArchiveAgainstChain`, `ArchiveExportError` and their types are exported from `@seedprotocol/archive/seed`, not the main entry (ADR 0031). The main entry no longer imports `@seedprotocol/sdk`, so `createBag`, `validateBag`, `verifyArchive`, `readBagInfo`, the path manifest functions, `parseArchiveDocument`, `dublinCoreXml` and `premisXml` load without it again, as in 0.8.0. In 0.8.1 `import '@seedprotocol/archive'` failed with `ERR_MODULE_NOT_FOUND` when the SDK wasn't installed. Change `import { exportArchive } from '@seedprotocol/archive'` to `'@seedprotocol/archive/seed'`.
- `ArchiveClockSource`, the type of `attestedAtClock` in `item.json`, is exported from `@seedprotocol/archive/seed`.
- `exportArchive` takes `Item.find`'s result without a cast: `ExportableItem.getService` returns any actor whose snapshot is an object. It required a snapshot type with `context`, which `IItem<any>` doesn't have (TS2345).
- **Breaking (bag format):** `EAS-Attester` in `bag-info.txt`, and the attester agent in `premis.xml`, are EIP-55 checksummed in every bag. An ordinary bag wrote the address as the database stored it, in lower case; a reproducible bag already wrote EAS's checksummed form. `Bag-Software-Agent` is `@seedprotocol/archive exportArchive (...)` and the PREMIS software agent is `@seedprotocol/archive`; both named `@seedprotocol/sdk`. A reproducible bag of a seed exported before this change has different bytes and a different tagmanifest hash now, so a bag anchored with 0.8.1 doesn't reproduce byte for byte (ADR 0031).
- A reproducible bag holds each file it reads from Arweave (item storage, storage seeds, embedded images) as the transaction's bytes when a content read transform is registered. It held the transform's output; ADR 0028 says the transaction's bytes. For a private Version that is the ciphertext.
- `verifyPublishedArchive`: when the anchor is found but its path manifest or tag files can't be read, `anchor`, `identity`, `record` and `fixity` are `not_checked` with the read error. `anchor` said "There is no anchored hash to compare with", which blamed the anchor for a gateway failure. The `asOf` option's comment says it must equal the anchor's `covered_until`.
- `engines.node` is `>=20.18.1`, the floor of its dependencies `@seedprotocol/eas` and `@seedprotocol/query`. It said `>=20.12.0`, where those dependencies don't install.
- `buildPathManifest` lists `data/index.html` again as `index.html` and makes that the index. arweave.net served nested paths but 404'd at the root of the first OP Sepolia anchor's manifest: HyperBEAM splits the index path on `/`. `readBagFromManifest` leaves `index.html` out of the bag and still reads manifests whose index is `data/index.html`. New anchors get a different manifest; bags and their hashes don't change.

### Commits

#### Fixes

- arweave, rdf, vite: archive /seed entry, bag format 2, raw reads, rdf defaults (ce7c0ca8)
- query, eas, rdf: QueryModels typing, unfilled references, readSeedAtTime, uid case (d122f018)
- release, vite: refuse a publish that keeps workspace: ranges; rdf sidecar check after install (6d4fc3ba)
- index.html at the manifest root for HyperBEAM gateways (fa734bd9)

## 0.8.1 (2026-11-04)

- `exportArchive`, `verifyArchiveAgainstChain`, `ArchiveExportError` and their types moved here from `@seedprotocol/sdk` (ADR 0031), with the changes below. `@seedprotocol/sdk` is an optional peer: the main entry imports it, and `@seedprotocol/archive/verify` and `@seedprotocol/archive/node` don't. **Breaking** for code that imports the main entry without the SDK installed.
- `exportArchive` takes `expectedAttestations`: with `reproducible`, it refuses with `not_synced` until EAS reports those uids, so a bag built right after a publish can't be silently incomplete. A seed with no Version on EAS is `not_synced`, not `not_published`. A reproducible bag holds attested properties only and no schema name, and its default time covers storage seeds. `VERIFY.txt` gives the rebuild command with the bag's `asOf`.
- `exportArchive` returns `arweaveTransactions`: with `reproducible`, each bag path whose bytes a published transaction already holds, for `buildPathManifest`.
- `exportArchive` takes `reproducible`: every client with the same schema gets the same bytes and the same tagmanifest hash for a seed at one time. Values, times and the attester come from EAS and file bytes from their Arweave transactions, with no rows read, so `item` can be `{ seedUid, modelName, schemaName }` on a device that holds nothing for the seed. `asOf` (unix seconds) pins the time: a later patch, Version, retraction or revocation doesn't change that bag. It throws `not_synced`, `chain_unavailable`, `incomplete` or `invalid_options` instead of writing a bag another client couldn't reproduce. Files are typed by their bytes, and bag-info.txt carries `Seed-Bag-Format` and `Seed-Bag-As-Of`. Every time in a bag, reproducible or not, now says whose clock it came from (`chain-block`, `local-record`, `export-device`), in PREMIS event details, `item.json` and `bag-info.txt`.
- New `verifyArchiveAgainstChain(bag, item)` checks a bag against a fresh reproducible export of the item at the time the bag covers, on top of `verifyArchive`'s checks. Every bag from `exportArchive` now carries `VERIFY.txt`.
- `exportArchive` writes each Html to `data/source/` byte for byte. It decoded and encoded the text again, which dropped a BOM and replaced invalid UTF-8.
- `exportArchive` records a published Relation or List of relations in `item.json` as seed uids. It wrote `null` for them. A related seed with no uid stays as its local id and is listed in `omitted`.
- New entry `@seedprotocol/archive/verify`: `verifyPublishedArchive({ versionUid, easEndpoint, gateways, asOf })` finds a Version's anchor on EAS, rebuilds its bag from the path manifest and reports `attestation`, `fixity`, `anchor`, `identity`, `record`, `revocation` and `timestamp` separately. `attestation` is `no_anchor` for a Version with no anchor from its attester, and `not_checked` for one EAS hasn't reported. `record` checks that the attestations in `data/item.json` are on the Version from its attester, and `recorded` returns them with their Arweave transactions. `revocation` also fails for a revoked seed. Options `maxBytes`, `onProgress` and `signal`; `size` reports `Payload-Oxum`. Also `findArchiveAnchors`, which reads EAS only, `decodeArchiveAnchorData`, and the constants `ARCHIVE_ANCHOR_SCHEMA_UID` and `VERSION_SCHEMA_UID`.
- `readBagFromManifest` takes `{ only }` to read some paths.
- New `buildPathManifest(bag, transactions)`, `parsePathManifest(bytes)` and `readBagFromManifest(manifest, fetchTransaction)`, with `PATH_MANIFEST_CONTENT_TYPE`: a bag on Arweave as an `arweave/paths` 0.2.0 manifest, and back. `ArchiveErrorCode` gains `invalid_manifest` and `missing_file`.
- New `verifyArchive(bag, { expectedTagmanifestSha256 })` reports `fixity` and `anchor` separately, and fails `fixity` for a bag with no `tagmanifest-sha256.txt`. `readBagInfo` reads bag-info.txt, and `verifyInstructions` writes the text of VERIFY.txt.

### Commits

#### Features

- no_anchor, record check, maxBytes and progress in verifyPublishedArchive; findArchiveAnchors (fd040a79)
- verifyPublishedArchive, a browser entry that checks a bag against its anchor (7e95bff1)
- a bag on Arweave as a path manifest (ac1f80da)
- verifyArchive, VERIFY.txt and verifyArchiveAgainstChain (a20bd6e5)

#### Fixes

- sdk: a reproducible bag describes the record, and can wait for it (946566a9)

#### Other

- archive is an add-on over the SDK (ADR 0031) (a142092d)
- exportArchive moves from the SDK into archive (38df2da0)

## 0.8.0 (2026-10-30)

No user-facing changes; released at the same version as the other packages.

## 0.7.13 (2026-10-29)

No user-facing changes; released at the same version as the other packages.

## 0.7.12 (2026-10-27)

- The published `.d.ts` files resolve under `moduleResolution: node16` and `nodenext`: relative imports carry `.js` (or `/index.js`). Without the extensions, named re-exports were typed `any` and names re-exported with `export *` were missing (TS2305).
- `engines` declares Node 20.12 or later: `readBagDirectory` reads `Dirent.parentPath`.

### Commits

#### Fixes

- publish: restoreFromDb locks before marking interrupted; optional uploadApiBaseUrl; export MissingSignedDataItemsError (e0966829)

## 0.7.11 (2026-10-24)

No user-facing changes; released at the same version as the other packages.

## 0.7.10 (2026-10-24)

- New package. `createBag` and `validateBag` write and check BagIt 1.0 bags with SHA-256 and SHA-512 payload and tag manifests; `writeBagDirectory` and `readBagDirectory` (from `@seedprotocol/archive/node`) move them to and from disk. `parseArchiveDocument` reads an h-entry archive document, `rewriteHtmlUrls` splices new `src`/`href`/`poster` values into Html, and `dublinCoreXml` and `premisXml` write Dublin Core and PREMIS 3.0 metadata.
