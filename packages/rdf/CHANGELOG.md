# Changelog

All notable changes to this package are documented in this file.

## Unreleased

- New package. `exportSeeds(seedUids, { chainId })` reads seeds with `getSeedAttestations` from @seedprotocol/query and returns their state graph: each seed's values at its head Version, with IRIs minted from the on-chain schemas (`{base}c/{model}`, `{base}p/{easType}/{easName}`, `{base}eas/{chainId}/{uid}`). `toQuads` gives RDF/JS quads; `toNQuads`, `toTurtle` and `toJsonLd` write RDF 1.1 N-Quads, Turtle and JSON-LD 1.1. `seedVocabulary` gives the Seed vocabulary in Turtle. The base IRI defaults to `PROVISIONAL_BASE_IRI`, which isn't registered yet.
- New `lens` option on `exportSeeds` and `stateGraph`: `{ schema, sidecar }` maps models and properties, by id, to terms such as `schema:headline`, and types Numbers (`xsd:integer`, `xsd:decimal`, canonical `xsd:double`) and Dates (`xsd:dateTime`). `StateGraph.warnings` lists terms it couldn't use.
