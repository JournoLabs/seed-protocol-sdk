# @seedprotocol/archive

[![npm](https://img.shields.io/npm/v/@seedprotocol/archive.svg)](https://www.npmjs.com/package/@seedprotocol/archive)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Archive packaging for [Seed Protocol](https://seedprotocol.io): [BagIt](https://www.rfc-editor.org/rfc/rfc8493)
1.0 bags with SHA-256 and SHA-512 manifests, [PREMIS 3.0](https://www.loc.gov/standards/premis/v3/)
and Dublin Core metadata, and a reader for [h-entry](https://microformats.org/wiki/h-entry) archive
documents. It works on bytes and plain objects and depends on no other Seed package, so archive
tools and servers can use it without the SDK.

To export a Seed item, use `exportArchive` from [`@seedprotocol/sdk`](https://www.npmjs.com/package/@seedprotocol/sdk),
which builds its bag with this package. The bag's layout is described in
[docs/ARCHIVE.md](https://github.com/JournoLabs/seed-protocol-sdk/blob/main/docs/ARCHIVE.md).

## Installation

```bash
npm install @seedprotocol/archive
```

## Bags

```ts
import { createBag, validateBag } from '@seedprotocol/archive'
import { writeBagDirectory, readBagDirectory } from '@seedprotocol/archive/node'

const bag = createBag({
  payload: [{ path: 'index.html', bytes: html }],          // paths relative to data/
  tagFiles: [{ path: 'metadata/dc.xml', bytes: dcXml }],    // listed in the tag manifests
  info: [['Source-Organization', 'The Daily Example']],
})
await writeBagDirectory(bag, './bag')                       // the directory must be empty or absent

const { valid, errors } = validateBag(await readBagDirectory('./bag'))
```

`createBag` adds Bagging-Date, Payload-Oxum and Bag-Software-Agent unless you pass them. It throws
`ArchiveError` for a path that won't survive another file system: absolute, `..` or empty
segments, backslashes, control characters, `%`, text not in Unicode NFC, or two paths that differ
only in letter case.

`validateBag` checks bagit.txt, every payload and tag manifest entry, unlisted payload files and
Payload-Oxum. It checks SHA-256 and SHA-512 manifests and reports a manifest for any other
algorithm as an error. For an independent check, run the Library of Congress validator:
`pipx run --spec bagit==1.9.0 bagit.py --validate ./bag`.

## Archive documents

```ts
import { parseArchiveDocument, rewriteHtmlUrls } from '@seedprotocol/archive'

const { method, content, name, summary, authors, published, featured } = parseArchiveDocument(html)
```

The body is read from `.h-entry .e-content`, then `[itemprop=articleBody]`, then a lone
`<article>` without its `<header>` and `<footer>`, then the whole input; `method` says which.
`content` is sliced from the source string, so it comes back byte for byte. Only the h-entry
properties archives use are read (p-name, p-summary, p-author, dt-published, u-featured, u-url,
e-content); implied properties and value-class patterns are not applied.

`rewriteHtmlUrls(html, map)` replaces whole `src`, `href` and `poster` values that `map` returns a
new URL for, by splicing them into the original string. `srcset` is not rewritten.

## Metadata

`dublinCoreXml(record)` writes an `oai_dc:dc` record; `premisXml({ objects, events, agents })`
writes PREMIS 3.0 with event and agent types from the Library of Congress preservation
vocabularies (`valueURI="http://id.loc.gov/vocabulary/preservation/eventType/cre"` and so on).
Both validate against the official schemas.
