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
VERIFY.txt                    the commands to check the bag by hand
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

**PREMIS events** come from the version history: the first live Version is the creation event,
each later Version and each property attestation that holds a current value and was made after
the current Version (a patch) is a modification, and the bag adds a message digest calculation and
an information package creation event. Attestations without a time are left out, since a PREMIS
event needs one. The attester is an agent identified by its EVM address, with no agent type: an
address doesn't say whether it is a person or an organization.

**Every time says whose clock it came from**, in each PREMIS event's detail, in `data/item.json`
(`attestedAtClock` next to each `attestedAt`) and in bag-info.txt's `Seed-Bag-Times`:

- `chain-block`: the attestation's `timeCreated` as EAS reports it, which is the block time on the
  attesting chain.
- `local-record`: the attestation time stored on the exporting device. For data synced from EAS
  that is the block time. For an attestation the device published itself, it is the block time
  when publish could read it, and otherwise the device's own clock; the database doesn't record
  which.
- `export-device`: the exporting device's clock, used for the bag's own events in an ordinary
  export.

## Reproducible bags

`exportArchive(item, { reproducible: true })` builds the bag every client gets for the Version:
the same bytes, so the same `tagmanifest-sha256.txt` hash, from any device that has the Version
synced and reads it with the same schema. This is the bag to anchor, sign or publish.

- Every time comes from EAS (`chain-block`), and so does the attester's address. The bag is dated
  with the current Version's attestation, not the export time.
- Nothing local to the exporting device goes in: `sourceOrganization` and `baggingDate` are
  refused, PREMIS names files on Arweave as `ar://<tx>` rather than by the configured gateway, and
  every list is in a fixed order.
- History stops at the current Version and leaves revocations out, so revoking an older or a later
  Version doesn't change the bag. Check a Version's revocation status on EAS, not in the bag.
- A file's type comes from its bytes, because its local name differs between devices. A type the
  bytes don't show is recorded as `application/octet-stream`.
- bag-info.txt's `Seed-Bag-Format` names the rules the bag was built under (see
  [ADR 0028](adr/0028-reproducible-bag-format.md)).
- It reads the seed, its Versions and the current Version's property attestations from the EAS
  indexer, and refuses (`not_synced`) when the device's copy is behind: EAS has a newer live
  Version, or a property attestation on this Version that the device hasn't synced.
- A bag that would leave something out is refused (`incomplete`) rather than written with an
  omission another client might not have.

An ordinary export reads local rows only, works offline (with `fetch: false`), and can differ from
device to device.

## Verifying a bag

`verifyArchive(bag, { expectedTagmanifestSha256 })` from `@seedprotocol/archive` needs no Seed code
or network. `fixity` checks the bag against its own manifests. `anchor` compares the SHA-256 of
`tagmanifest-sha256.txt` with a hash from outside the bag, and stays `not_checked` without one.
Each check is reported on its own, because anyone who changes a file can rewrite the manifests too:
`fixity` alone says the bag is intact, and not that it's the bag you expect.

`verifyArchiveAgainstChain(bag, item)` from `@seedprotocol/sdk` adds `rebuilt`: it makes a
reproducible export of the item from EAS and compares the two bags, listing what differs in
`differingFiles`.

```ts
import { verifyArchiveAgainstChain } from '@seedprotocol/sdk'

const { fixity, rebuilt, differingFiles } = await verifyArchiveAgainstChain(bag, post)
```

`rebuilt` is `not_checked`, with the reason in `detail`, for an ordinary export, a bag of another
seed, a bag of an older Version (only the current Version can be rebuilt), a bag in another
`Seed-Bag-Format`, or an export that refuses. EAS doesn't record a bag's hash yet, so this rebuild is the
SDK's only hash source.

Every bag carries `VERIFY.txt` with the `shasum` commands to check it by hand.

## What an attestation proves

A Seed attestation shows that its attester published these bytes no later than the block time of
the attestation. It does not show who wrote the content, that it was true, or that the attester
is the person or organization a reader assumes. Where the bytes are a copy of someone else's page,
the attestation doesn't show that they were fetched from that page or when the page served them;
only a capture's own provenance record makes that claim, at the capture provider's clock. A bag's
checksums show that its files haven't changed since the bag was made, and say nothing about the
files before that.

## When export refuses or leaves something out

`exportArchive` throws `ArchiveExportError` with:

- `not_published` when the item has no live published Version (never published, or unpublished).
- `unpublished_changes` when a property holds a saved value that isn't published yet. Publish
  first: the bag is the published record, and mixing in local edits would make it something no
  attestation backs.
- With `reproducible`: `not_synced` and `incomplete` as above, `chain_unavailable` when the EAS
  indexer can't be read, and `invalid_options` for `sourceOrganization` or `baggingDate`.

A file that can't be read or downloaded doesn't fail an ordinary export. It is listed in `omitted` (and
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
