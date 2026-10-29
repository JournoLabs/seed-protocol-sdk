/**
 * Base of every IRI the export mints. Provisional: the permanent namespace (w3id.org, see the RDF
 * plan) isn't registered yet, so don't publish exports that use it anywhere they can't be
 * replaced, such as an archive on Arweave.
 */
export const PROVISIONAL_BASE_IRI = 'https://w3id.org/seedprotocol/'

export const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
export const XSD = 'http://www.w3.org/2001/XMLSchema#'
export const PROV = 'http://www.w3.org/ns/prov#'

export const RDF_TYPE = `${RDF}type`
export const RDF_FIRST = `${RDF}first`
export const RDF_REST = `${RDF}rest`
export const RDF_NIL = `${RDF}nil`

// Characters N-Triples and Turtle don't allow in an IRIREF, plus controls and space.
const INVALID_IRI = /[\u0000- <>"{}|^`\\]/

/** Throws when `iri` can't be written as an IRI in N-Quads, Turtle or JSON-LD. */
export function assertIri(iri: string, what: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(iri) || INVALID_IRI.test(iri)) {
    throw new TypeError(`${what} is not an absolute IRI: ${JSON.stringify(iri)}`)
  }
  return iri
}

/** The IRIs one export uses, from its base and chain. */
export type IriScheme = {
  readonly base: string
  readonly chainId: number
  /** The Seed vocabulary namespace, `{base}ns#`. */
  readonly seed: string
  /** A Seed, Version or other attestation on this chain. */
  attestation(uid: string): string
  /** The class for an on-chain model type (the Seed schema `bytes32 <model>`). */
  modelClass(modelType: string): string
  /** The predicate for an on-chain property schema `<easType> <easName>`. */
  property(easType: string, easName: string): string
  /** An attester address as a CAIP-10 `did:pkh`. */
  account(address: string): string
}

export function iriScheme(chainId: number, base: string = PROVISIONAL_BASE_IRI): IriScheme {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new TypeError(`chainId must be a positive integer, got ${chainId}`)
  }
  assertIri(base, 'base')
  if (!base.endsWith('/')) throw new TypeError(`base must end with "/": ${base}`)
  const segment = (s: string) => encodeURIComponent(s)
  return {
    base,
    chainId,
    seed: `${base}ns#`,
    attestation: (uid) => `${base}eas/${chainId}/${segment(uid.toLowerCase())}`,
    modelClass: (modelType) => `${base}c/${segment(modelType)}`,
    property: (easType, easName) => `${base}p/${segment(easType)}/${segment(easName)}`,
    account: (address) => `did:pkh:eip155:${chainId}:${segment(address.toLowerCase())}`,
  }
}
