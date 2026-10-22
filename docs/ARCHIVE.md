# Exporting an item as an archive

`exportArchive(item)` writes a published item as a [BagIt](https://www.rfc-editor.org/rfc/rfc8493)
bag: a directory of files with checksum manifests that BagIt tools (the Library of Congress's
`bagit.py`, Archivematica's bag transfers) can validate without Seed code. The bag holds
the item's Html, its files and its attested values, with Dublin Core and PREMIS metadata.

```ts
import { exportArchive } from '@seedprotocol/sdk'
import { writeBagDirectory } from '@seedprotocol/archive/node'

const { bag, omitted } = await exportArchive(post, { sourceOrganization: 'The Daily Example' })
await writeBagDirectory(bag, './post-bag')
```

`bag.files` is a list of `{ path, bytes }`, so in a browser you can zip it or write it to OPFS
instead. `writeBagDirectory` (Node) refuses a directory that isn't empty, so a bag never mixes
with files its manifests don't list.

## What the bag contains

```
bagit.txt                     BagIt-Version: 1.0
bag-info.txt                  Seed and Version uids, chain, attester, Payload-Oxum
manifest-sha256.txt           payload checksums
manifest-sha512.txt
metadata/dc.xml               Dublin Core (oai_dc)
metadata/premis.xml           PREMIS 3.0 objects, events and agents
tagmanifest-sha256.txt        checksums of every file above
tagmanifest-sha512.txt
data/index.html               the Html, with references to bagged files made relative
data/source/<property>.html   the Html exactly as published
data/assets/<sha256>.<ext>    Images, Files and images the Html references
data/item.json                every property's value, attestation uid and Arweave transaction
```

A model with more than one Html property gets `data/<property>.html` for each instead of
`data/index.html`.

**The view copy and the source.** Published Html points at files by gateway URL
(`https://<gateway>/raw/<tx>`). In `data/index.html` each such URL, and each `seed:property/`
placeholder, is replaced with the bag path of the same file, so the page opens offline from the
bag. Only those attribute values change; every other byte is as published. `data/source/` keeps
the Html exactly as it was sealed, because an archive keeps the original next to any copy made
for display.

**Descriptive metadata** comes from the Html when it is an
[h-entry](https://microformats.org/wiki/h-entry): `p-name` is the title, `p-summary` the
description, each `p-author` a creator, `dt-published` the date and `u-url` the source. Nothing is
guessed from property names. Without an h-entry the Dublin Core record has the identifiers, type
and the Version's date only.

**PREMIS events** come from the local version history: the first live Version is the creation
event, each later Version and each property attested again on the current Version (a patch) is a
modification, and the bag adds a message digest calculation and an information package creation
event. Attestations without a recorded time are left out, since a PREMIS event needs one. The
attester is an agent identified by its EVM address, with no agent type: an address doesn't say
whether it is a person or an organization.

## When export refuses or leaves something out

`exportArchive` throws `ArchiveExportError` with:

- `not_published` when the item has no live published Version (never published, or unpublished).
- `unpublished_changes` when a property holds a saved value that isn't published yet. Publish
  first: the bag is the published record, and mixing in local edits would make it something no
  attestation backs.

A file that can't be read or downloaded doesn't fail the export. It is listed in `omitted` (and
in `data/item.json`) with the reason, and the bag is still valid for what it holds. An Html
reference to an Arweave transaction that isn't in the bag stays as its gateway URL and is listed
the same way. By default export downloads files that aren't on this device; pass `fetch: false`
to use local files only.

Not exported yet: Json storage seeds, and related items (a Relation or List records the related
seeds' uids in `data/item.json`, but their content is not in the bag).

## Validating a bag

```bash
pipx run --spec bagit==1.9.0 bagit.py --validate ./post-bag
```

`validateBag(bag)` from `@seedprotocol/archive` runs the same checks in memory. Bag paths never
contain `%`: RFC 8493 writes it as `%25` in manifests, and bagit-python 1.9.0 doesn't decode that,
so it would report the file as missing.
