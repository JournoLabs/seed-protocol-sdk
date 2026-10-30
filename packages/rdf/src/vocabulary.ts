import { PROVISIONAL_BASE_IRI, assertIri } from './iri.js'

/**
 * The Seed vocabulary (`{base}ns#`) in Turtle: the classes and properties the state graph uses
 * that PROV-O and schema.org don't already have.
 */
export function seedVocabulary(base: string = PROVISIONAL_BASE_IRI): string {
  assertIri(base, 'base')
  return `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix seed: <${base}ns#> .

seed:Seed a rdfs:Class ;
    rdfs:label "Seed" ;
    rdfs:comment "An item: the EAS attestation that names it. Its IRI carries the chain id and attestation uid." .

seed:Version a rdfs:Class ;
    rdfs:label "Version" ;
    rdfs:comment "A version of a Seed: an EAS attestation whose refUID is the Seed. Property attestations reference a Version." .

seed:versionOf a rdf:Property ;
    rdfs:label "version of" ;
    rdfs:domain seed:Version ;
    rdfs:range seed:Seed .

seed:currentVersion a rdf:Property ;
    rdfs:label "current version" ;
    rdfs:comment "The Version the exported values were read from." ;
    rdfs:domain seed:Seed ;
    rdfs:range seed:Version .

seed:content a rdf:Property ;
    rdfs:label "content" ;
    rdfs:comment "The stored bytes of an Image, File, Html or Json seed, as an ar:// IRI." ;
    rdfs:domain seed:Seed .
`
}
