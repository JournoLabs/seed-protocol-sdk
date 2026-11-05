# @seedprotocol/rdf

RDF export for [Seed Protocol](https://seedprotocol.io) items. It reads seeds through
[`@seedprotocol/query`](https://www.npmjs.com/package/@seedprotocol/query) and gives their current
values as a graph: RDF/JS quads, N-Quads, Turtle or JSON-LD. It doesn't depend on the SDK.

Every IRI comes from what is on chain, so an app gets RDF for its own models without registering
anything. **The base IRI is provisional:** `https://w3id.org/seedprotocol/` isn't registered yet,
so don't write exports into anything you can't replace later, such as an archive on Arweave.

## Installation

```bash
npm install @seedprotocol/rdf
```

## Export

```ts
import { exportSeeds, toTurtle, toJsonLd, toNQuads, toQuads } from '@seedprotocol/rdf'

const graph = await exportSeeds([seedUid], { chainId: 11155420 })

toTurtle(graph)   // Turtle (RDF 1.1)
toNQuads(graph)   // N-Quads
toJsonLd(graph)   // JSON-LD 1.1 object with an inline @context
toQuads(graph)    // RDF/JS quads for N3.js, Comunica, Oxigraph or rdf-ext
```

`exportSeeds` takes the `source` and `pins` options of `getSeeds`, plus:

| Option | |
|---|---|
| `asOf` | Unix seconds. The graph EAS held then: attestations made later are left out, and one revoked later counts. Reads EAS, so `source: 'local'` is refused. See [A graph beside an archive bag](#a-graph-beside-an-archive-bag). |
| `chainId` | The chain the seeds were attested on. Required: EAS uids don't include it. |
| `base` | Base of the minted IRIs, ending in `/`. Default `PROVISIONAL_BASE_IRI`. |
| `contentUrl` | `(transactionId) => string`, an `https://` URL for stored content, written as `schema:contentUrl`. |
| `lens` | `{ schema, sidecar }`: maps your models and properties to terms and types Numbers and Dates. See [Lens](#lens). |

To export seeds you have already read, pass the entries of `getSeedAttestations` to `stateGraph`.

## What the graph contains

For each seed, at its head Version (or the pinned one):

| Seed | RDF |
|---|---|
| The seed | `{base}eas/{chainId}/{seedUid}`, typed `seed:Seed` and `{base}c/{model}` |
| Its attester and creation time | `prov:wasAttributedTo <did:pkh:eip155:{chainId}:{address}>`, `prov:generatedAtTime` |
| Its head Version | `seed:currentVersion` |
| Its Versions up to the head | Each a `seed:Version` with `seed:versionOf` the seed, `prov:generatedAtTime`, `prov:wasAttributedTo` its attester and `prov:wasRevisionOf` the Version before. Revoked Versions and Versions from other attesters are left out. |
| A property `string title` | `{base}p/string/title` with the newest value the seed's attester attested |
| A relation | The related seed's IRI |
| A list of relations | An RDF list of seed IRIs, in order |
| An Image, File, Html or Json seed | `seed:content <ar://{transactionId}>` beside its `storage_transaction_id` |

Literals are typed from the EAS type: `bool` is `xsd:boolean`, integer types are `xsd:integer`,
`bytes` values are `xsd:hexBinary`, and everything else is `xsd:string`. A Number is an EAS
`string` (ADR 0010) and a Date a `uint256` of seconds, so without a [lens](#lens) they come out
as `xsd:string` and `xsd:integer`. A removed value (ADR 0021) is left out. The graph has no blank
nodes except the cells of lists.

`seedVocabulary()` returns the `seed:` terms in Turtle.

The same seeds, `asOf`, options and sidecar give the same bytes from `toJsonLd`, `toTurtle` and
`toNQuads`, whatever order EAS returns attestations in. Seeds are written in the order you pass
them.

## A graph beside an archive bag

A reproducible archive bag from `@seedprotocol/archive` records the seed, the time it covers and
the chain in bag-info.txt. Export with that time and the graph holds the same attestations as the
bag, plus the Version history. Anyone can rebuild it from EAS and compare bytes.

```ts
import { readBagInfo } from '@seedprotocol/archive'
import { exportSeeds, toJsonLd } from '@seedprotocol/rdf'

const info = readBagInfo(bag)
const graph = await exportSeeds([info.get('Seed-Uid')!], {
  chainId: Number(info.get('EAS-Chain-Id')),
  asOf: Date.parse(info.get('Seed-Bag-As-Of')!) / 1000,
  lens,
})
const jsonld = JSON.stringify(toJsonLd(graph))
```

The graph goes beside the bag, not in it: the bag's `tagmanifest-sha256.txt` hash and its anchor
don't cover it, and its IRIs use the provisional base. Neither package imports the other; your
app reads bag-info with archive and passes the three values to rdf.

rdf doesn't read the Html's h-entry. To give a title as `dcterms:title`, map the property in the
sidecar:

```json
{
  "schemaId": "blog-schema-id",
  "@context": { "dcterms": "http://purl.org/dc/terms/" },
  "terms": {
    "<title property id>": "dcterms:title",
    "<author property id>": "dcterms:creator",
    "<published at property id>": "dcterms:issued"
  }
}
```

## Lens

A protocol predicate such as `{base}p/string/title` says what is on chain, not what it means. A
lens adds that: pass your Schema and a sidecar, a JSON file that lives beside it.

```json
{
  "schemaId": "my-schema-id",
  "@context": { "schema": "https://schema.org/", "dcterms": "http://purl.org/dc/terms/" },
  "terms": {
    "<Post model id>": "schema:BlogPosting",
    "<title property id>": "schema:headline",
    "<publishedAt property id>": "schema:datePublished",
    "<authors property id>": "dcterms:creator"
  }
}
```

```ts
const graph = await exportSeeds([seedUid], { chainId, lens: { schema, sidecar } })
graph.warnings // terms it couldn't use, values that don't fit their type
```

`terms` is keyed by the `id` of a model or property in the Schema file, so renaming either keeps its
term. Values are a prefixed name, using the top-level strings of `@context`, or an absolute IRI.

- A mapped model's class replaces `{base}c/{model}`, and a mapped property's term replaces its
  protocol predicate. `seed:Seed` stays, and anything unmapped keeps its protocol IRI.
- A Number is typed per value: `xsd:integer`, `xsd:decimal`, or `xsd:double` in its canonical form
  (`1e+21` becomes `1.0E21`). A value that isn't a number stays an `xsd:string`, with a warning.
- A Date is an `xsd:dateTime` in UTC.
- On-chain names are matched to the Schema the way sync matches them, including `nameMatch`. An
  attestation made under a name the Schema no longer matches keeps its protocol predicate.

The graph also records which mapping it used: a `prov:Activity` at `{base}export/{sha256}`
with `prov:used <ni:///sha-256;…>` (RFC 6920), the SHA-256 of the sidecar's `schemaId`, `terms`
and `@context` as JSON with sorted keys. The node stands for the mapping, not for one export, so
two exports with the same sidecar name the same node, and it has no time or agent. Like every
minted IRI it uses the provisional base; keep it out of anything anchored.

A sidecar whose `schemaId` isn't the Schema's `id` throws. A term with no matching id or a prefix
`@context` doesn't define is a warning, and the export goes on without it.

## SHACL

```ts
import { toShacl } from '@seedprotocol/rdf'

const shapes = toShacl({ schema, sidecar }) // Turtle
```

`toShacl` describes the graphs `exportSeeds` gives with the same lens, in SHACL 2017. Each model is a
`sh:NodeShape` targeting the class its seeds get, and each property a property shape on the
predicate they get:

| Schema | Shape |
|---|---|
| Text, Boolean, Date | `sh:datatype` `xsd:string`, `xsd:boolean`, `xsd:dateTime` |
| Number | `sh:or` of `xsd:integer`, `xsd:decimal` and `xsd:double` |
| Relation, Image, File, Html, Json | `sh:nodeKind sh:IRI` |
| List | every cell of the `rdf:List` has one `rdf:first` and one `rdf:rest`; a List of relations' members are IRIs |
| `required: true` | `sh:minCount 1` |

Every property has `sh:maxCount 1`. A relation's class isn't checked, because the related seed is
often not in the export. For shapes over the protocol IRIs, pass a sidecar with empty `terms`.

## Keeping the sidecar current

The sidecar's own `@context` can carry a type-scoped context with your local names, for tools
that read the file as JSON-LD. It's generated from `terms`, so it goes stale when a model or
property is renamed; `terms` doesn't, because it's keyed by id.

```bash
seed-rdf check              # stale and unreadable terms, unmapped properties; exits 1 on the first two
seed-rdf sync --write       # regenerate @context and schemaVersion from terms and the current names
seed-rdf suggest            # draft schema.org / dcterms terms for unmapped names such as title or author
seed-rdf suggest --write    # add them to the sidecar, creating it if needed
```

Each command reads `seed.schema.json` and `seed.schema.context.jsonld` in the working directory;
`--schema` and `--sidecar` take other paths. `sync` and `suggest` print what they would write
unless given `--write`, and `sync` keeps stale terms: removing a mapping is your call. The same
functions are exported as `checkSidecar`, `syncSidecar`, `suggestTerms` and `sidecarContext`.

`seedVitePlugin` from `@seedprotocol/vite` runs the check on the dev server and warns when the
schema or sidecar changes.
