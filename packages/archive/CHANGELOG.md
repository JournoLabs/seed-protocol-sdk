# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- The published `.d.ts` files resolve under `moduleResolution: node16` and `nodenext`: relative imports carry `.js` (or `/index.js`). Without the extensions, named re-exports were typed `any` and names re-exported with `export *` were missing (TS2305).
- `engines` declares Node 20.12 or later: `readBagDirectory` reads `Dirent.parentPath`.

## 0.7.10 (2026-10-24)

- New package. `createBag` and `validateBag` write and check BagIt 1.0 bags with SHA-256 and SHA-512 payload and tag manifests; `writeBagDirectory` and `readBagDirectory` (from `@seedprotocol/archive/node`) move them to and from disk. `parseArchiveDocument` reads an h-entry archive document, `rewriteHtmlUrls` splices new `src`/`href`/`poster` values into Html, and `dublinCoreXml` and `premisXml` write Dublin Core and PREMIS 3.0 metadata.
