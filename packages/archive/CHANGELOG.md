# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- New `verifyArchive(bag, { expectedTagmanifestSha256 })` reports `fixity` and `anchor` separately, and fails `fixity` for a bag with no `tagmanifest-sha256.txt`. `readBagInfo` reads bag-info.txt, and `verifyInstructions` writes the text of VERIFY.txt.

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
