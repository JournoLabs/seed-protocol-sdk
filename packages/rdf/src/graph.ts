import type { SeedAttestations, SeedPropertyAttestation } from '@seedprotocol/query'
import { PROV, RDF_TYPE, XSD, assertIri, iriScheme, type IriScheme } from './iri.js'

/** An IRI, a typed literal, or an RDF list of either. */
export type RdfObject =
  | { readonly kind: 'iri'; readonly iri: string }
  | { readonly kind: 'literal'; readonly value: string; readonly datatype: string }
  | { readonly kind: 'list'; readonly items: readonly RdfObject[] }

/** One subject and its statements, predicates in the order they were added. */
export type RdfNode = {
  readonly id: string
  readonly properties: ReadonlyMap<string, readonly RdfObject[]>
}

/**
 * A state graph: each seed's current values at its head Version, in the default graph. Every
 * subject is an IRI; the only blank nodes are the cells of RDF lists, which writers create.
 */
export type StateGraph = {
  readonly iris: IriScheme
  readonly nodes: readonly RdfNode[]
}

export type StateGraphOptions = {
  /** The chain the seeds were attested on. EAS uids don't include it, so every IRI does. */
  chainId: number
  /** Base of the minted IRIs. Default PROVISIONAL_BASE_IRI. */
  base?: string
  /**
   * An `https://` URL for an Arweave transaction, given as `schema:contentUrl` beside the
   * `ar://` content IRI, since most RDF tools can't fetch `ar://`. None by default.
   */
  contentUrl?: (transactionId: string) => string
}

const SCHEMA_CONTENT_URL = 'https://schema.org/contentUrl'
const STORAGE_TRANSACTION = 'storage_transaction_id'
// Assembly skips this value as a relation (see relationValuesToExclude in @seedprotocol/query).
const NOT_A_SEED = '0x0000000000000000000000000000000000000000000000000000000000000020'

const iri = (value: string): RdfObject => ({ kind: 'iri', iri: value })
const literal = (value: string, datatype: string): RdfObject => ({ kind: 'literal', value, datatype })

/** `xsd:dateTime` in UTC for Unix seconds. */
function dateTime(seconds: number): RdfObject {
  return literal(new Date(seconds * 1000).toISOString().replace('.000Z', 'Z'), `${XSD}dateTime`)
}

const HEX = /^0x([0-9a-fA-F]*)$/

/** The literal for one non-relation value of EAS type `easType`. */
function scalar(easType: string, value: string | boolean): RdfObject {
  if (typeof value === 'boolean') return literal(String(value), `${XSD}boolean`)
  if (/^u?int\d*$/.test(easType) && /^-?\d+$/.test(value)) return literal(value, `${XSD}integer`)
  const hex = /^bytes\d*$/.test(easType) ? HEX.exec(value) : null
  if (hex && hex[1]!.length % 2 === 0) return literal(hex[1]!.toLowerCase(), `${XSD}hexBinary`)
  return literal(value, `${XSD}string`)
}

const objectKey = (object: RdfObject): string | undefined =>
  object.kind === 'iri' ? `<${object.iri}>` : object.kind === 'literal' ? `${object.value}^^${object.datatype}` : undefined

class NodeBuilder {
  readonly properties = new Map<string, RdfObject[]>()
  // A graph is a set: the same statement twice is written once.
  private readonly seen = new Set<string>()
  constructor(readonly id: string) {}
  add(predicate: string, object: RdfObject): void {
    const key = objectKey(object)
    if (key !== undefined) {
      if (this.seen.has(`${predicate} ${key}`)) return
      this.seen.add(`${predicate} ${key}`)
    }
    const objects = this.properties.get(predicate)
    if (objects) objects.push(object)
    else this.properties.set(predicate, [object])
  }
}

function propertyObject(iris: IriScheme, property: SeedPropertyAttestation): RdfObject | null {
  const { easType, value } = property
  if (property.isRelation) {
    const seeds = (typeof value === 'string' ? [value] : Array.isArray(value) ? value : []).filter(
      (uid) => uid !== NOT_A_SEED,
    )
    if (typeof value === 'string') return seeds[0] ? iri(iris.attestation(seeds[0])) : null
    return { kind: 'list', items: seeds.map((uid) => iri(iris.attestation(uid))) }
  }
  if (Array.isArray(value)) {
    const itemType = easType.replace(/\[\]$/, '')
    return { kind: 'list', items: value.map((v: string) => scalar(itemType, v)) }
  }
  return scalar(easType, value as string | boolean)
}

/**
 * The state graph of `seeds` (from `getSeedAttestations` in @seedprotocol/query). Each seed is
 * typed `seed:Seed` and its model class (`{base}c/{model}`), attributed to its attester as a
 * `did:pkh`, and linked to its head Version; each property is one statement with the protocol
 * predicate `{base}p/{easType}/{easName}`. Relations are Seed IRIs, lists are RDF lists, and an
 * Image, File, Html or Json seed's `storage_transaction_id` also gives `seed:content <ar://…>`.
 * Values are typed from the EAS type alone: a Number (an EAS `string`, ADR 0010) is an
 * `xsd:string`, and a Date (`uint256` seconds) an `xsd:integer`.
 */
export function stateGraph(seeds: readonly SeedAttestations[], options: StateGraphOptions): StateGraph {
  const iris = iriScheme(options.chainId, options.base)
  const ns = iris.seed
  const nodes = new Map<string, NodeBuilder>()
  const node = (id: string) => {
    let found = nodes.get(id)
    if (!found) nodes.set(id, (found = new NodeBuilder(id)))
    return found
  }

  for (const { record, properties } of seeds) {
    if (nodes.has(iris.attestation(record.seedUid))) continue
    const seed = node(iris.attestation(record.seedUid))
    seed.add(RDF_TYPE, iri(`${ns}Seed`))
    seed.add(RDF_TYPE, iri(iris.modelClass(record.schemaName)))
    if (record.attester) seed.add(`${PROV}wasAttributedTo`, iri(iris.account(record.attester)))
    if (record.timeCreated > 0) seed.add(`${PROV}generatedAtTime`, dateTime(record.timeCreated))

    if (record.versionUid) {
      const versionIri = iris.attestation(record.versionUid)
      seed.add(`${ns}currentVersion`, iri(versionIri))
      const version = node(versionIri)
      version.add(RDF_TYPE, iri(`${ns}Version`))
      version.add(`${ns}versionOf`, iri(seed.id))
    }

    for (const property of properties) {
      const object = propertyObject(iris, property)
      if (!object) continue
      seed.add(iris.property(property.easType, property.easName), object)
      if (property.easName === STORAGE_TRANSACTION && typeof property.value === 'string' && property.value) {
        const transactionId = encodeURIComponent(property.value)
        seed.add(`${ns}content`, iri(`ar://${transactionId}`))
        if (options.contentUrl) {
          seed.add(SCHEMA_CONTENT_URL, iri(assertIri(options.contentUrl(property.value), 'contentUrl')))
        }
      }
    }
  }

  return { iris, nodes: [...nodes.values()] }
}
