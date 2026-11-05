# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- **Breaking:** `seed-rdf` reads `seed.schema.json` when `--schema` isn't given, and the sidecar defaults to `seed.schema.context.jsonld`. They were `seedSchema.json` and `seedSchema.context.jsonld`, names neither the SDK nor its docs use. Rename the files or pass `--schema`. The name is exported as `DEFAULT_SCHEMA_FILE`.
- `seedVocabulary(base)` throws a `TypeError` for a base without a trailing `/`, as `iriScheme` does. It wrote `{base}ns#` IRIs that didn't match the graph's.
- `suggestTerms` suggests `schema:associatedMedia` for an Html property named `html`, `body` or `content`. It suggested `schema:text`, whose range is Text, for a value that is a storage seed's IRI.
- The state graph links no seed for any unfilled reference slot (a relation value below 2^32). It skipped only `0x…20`, so `stateGraph` given another placeholder linked it as a seed.
- `engines.node` is `>=20.18.1`, the floor of its dependencies `@seedprotocol/eas` and `@seedprotocol/query`. It said `>=20.12.0`, where those dependencies don't install.

## 0.8.1 (2026-11-04)

- New package. `exportSeeds(seedUids, { chainId })` reads seeds with `getSeedAttestations` from @seedprotocol/query and returns their state graph: each seed's values at its head Version, with IRIs minted from the on-chain schemas (`{base}c/{model}`, `{base}p/{easType}/{easName}`, `{base}eas/{chainId}/{uid}`). `toQuads` gives RDF/JS quads; `toNQuads`, `toTurtle` and `toJsonLd` write RDF 1.1 N-Quads, Turtle and JSON-LD 1.1. `seedVocabulary` gives the Seed vocabulary in Turtle. The base IRI defaults to `PROVISIONAL_BASE_IRI`, which isn't registered yet.
- New `lens` option on `exportSeeds` and `stateGraph`: `{ schema, sidecar }` maps models and properties, by id, to terms such as `schema:headline`, and types Numbers (`xsd:integer`, `xsd:decimal`, canonical `xsd:double`) and Dates (`xsd:dateTime`). `StateGraph.warnings` lists terms it couldn't use.
- `toShacl(lens)` writes SHACL 2017 shapes in Turtle for exports made with that lens: a `sh:NodeShape` per model targeting its class, and per property its predicate, `sh:datatype`, `sh:maxCount 1`, `sh:minCount 1` when `required`, and `rdf:List` checks for Lists.
- `sidecarContext(lens)` generates a type-scoped JSON-LD `@context` from the sidecar's `terms` and the schema's current names. `checkSidecar` lists stale terms, unreadable terms and unmapped models and properties; `syncSidecar` regenerates `@context` and sets the new optional `schemaVersion`; `suggestTerms` drafts schema.org and dcterms terms for common names.
- An export with a lens includes a `prov:Activity` at `{base}export/{sha256}` with `prov:used <ni:///sha-256;…>`, the hash of the sidecar's `schemaId`, `terms` and `@context` as canonical JSON. The same sidecar always gives the same node; it has no time or agent.
- `exportSeeds` takes `asOf` (unix seconds) and exports what EAS held then, the same attestations as a reproducible archive bag with that `Seed-Bag-As-Of`. It reads EAS and refuses `source: 'local'`.
- The state graph has the seed's Version history: each live Version up to the head is a `seed:Version` with `prov:generatedAtTime`, `prov:wasAttributedTo` and `prov:wasRevisionOf` the Version before. Revoked Versions are left out.
- Properties are written in name order, so the same state gives the same bytes from every writer whatever order EAS returns attestations in.
- New `seed-rdf` bin: `seed-rdf check` (exits 1 on stale or unreadable terms, for CI), `seed-rdf sync [--write]` and `seed-rdf suggest [--write]`.
