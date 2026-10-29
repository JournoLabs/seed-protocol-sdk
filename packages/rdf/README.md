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
| `chainId` | The chain the seeds were attested on. Required: EAS uids don't include it. |
| `base` | Base of the minted IRIs, ending in `/`. Default `PROVISIONAL_BASE_IRI`. |
| `contentUrl` | `(transactionId) => string`, an `https://` URL for stored content, written as `schema:contentUrl`. |

To export seeds you have already read, pass the entries of `getSeedAttestations` to `stateGraph`.

## What the graph contains

For each seed, at its head Version (or the pinned one):

| Seed | RDF |
|---|---|
| The seed | `{base}eas/{chainId}/{seedUid}`, typed `seed:Seed` and `{base}c/{model}` |
| Its attester and creation time | `prov:wasAttributedTo <did:pkh:eip155:{chainId}:{address}>`, `prov:generatedAtTime` |
| Its head Version | `seed:currentVersion`; the Version is a `seed:Version` with `seed:versionOf` the seed |
| A property `string title` | `{base}p/string/title` with the newest value the seed's attester attested |
| A relation | The related seed's IRI |
| A list of relations | An RDF list of seed IRIs, in order |
| An Image, File, Html or Json seed | `seed:content <ar://{transactionId}>` beside its `storage_transaction_id` |

Literals are typed from the EAS type: `bool` is `xsd:boolean`, integer types are `xsd:integer`,
`bytes` values are `xsd:hexBinary`, and everything else is `xsd:string`. A Number is an EAS
`string` (ADR 0010) and a Date a `uint256` of seconds, so without the app's Schema they come out
as `xsd:string` and `xsd:integer`. A removed value (ADR 0021) is left out. The graph has no blank
nodes except the cells of lists.

`seedVocabulary()` returns the `seed:` terms in Turtle.
