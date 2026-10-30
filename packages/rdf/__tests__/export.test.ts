import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Parser, Store } from 'n3'
import jsonld from 'jsonld'
import { canonize } from 'rdf-canonize'
import SHACLValidator from 'rdf-validate-shacl'
import { clearLocalQuerySource, registerLocalQuerySource } from '@seedprotocol/query'
import {
  PROVISIONAL_BASE_IRI,
  exportSeeds,
  seedVocabulary,
  stateGraph,
  toJsonLd,
  toNQuads,
  toQuads,
  toTurtle,
  type StateGraph,
} from '../src/index'
import {
  ATTESTER,
  AUTHOR_1,
  AUTHOR_2,
  CHAIN_ID,
  HTML,
  HTML_V,
  POST,
  POST_V2,
  PUBLISHED_AT,
  TITLE,
  TRANSACTION_ID,
  localSource,
} from './fixtures'

const B = PROVISIONAL_BASE_IRI
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const at = (uid: string) => `${B}eas/${CHAIN_ID}/${uid}`

/** RDFC-1.0 canonical N-Quads, so graphs from different writers and parsers compare as strings. */
const canonical = (nquads: string): Promise<string> =>
  canonize(nquads, { algorithm: 'RDFC-1.0', inputFormat: 'application/n-quads' })

/** Re-serialize quads parsed by N3.js, so the comparison doesn't trust our writer. */
const parse = (text: string, format: 'Turtle' | 'N-Quads') => new Parser({ format }).parse(text)
const viaN3 = (text: string, format: 'Turtle' | 'N-Quads') =>
  canonical(
    parse(text, format)
      .map((q) => {
        const t = (term: { termType: string; value: string; datatype?: { value: string } }) =>
          term.termType === 'NamedNode'
            ? `<${term.value}>`
            : term.termType === 'BlankNode'
              ? `_:${term.value}`
              : `${JSON.stringify(term.value)}^^<${term.datatype!.value}>`
        return `${t(q.subject)} ${t(q.predicate)} ${t(q.object)} .\n`
      })
      .join(''),
  )

let graph: StateGraph

beforeEach(async () => {
  registerLocalQuerySource(localSource())
  graph = await exportSeeds([POST, HTML], { chainId: CHAIN_ID, source: 'local' })
})

afterEach(() => clearLocalQuerySource())

/** Objects of `predicate` on `subject`, from the graph as N3.js parses our N-Quads. */
function objects(subject: string, predicate: string) {
  const store = new Store(parse(toNQuads(graph), 'N-Quads'))
  return store.getObjects(subject, predicate, null)
}

describe('state graph', () => {
  it('types each seed as seed:Seed and its on-chain model class', () => {
    expect(objects(at(POST), `${RDF}type`).map((o) => o.value).sort()).toEqual([`${B}c/post`, `${B}ns#Seed`])
    expect(objects(at(HTML), `${RDF}type`).map((o) => o.value)).toContain(`${B}c/html`)
  })

  it('attributes the seed to its attester as a lowercase did:pkh, with its creation time', () => {
    expect(objects(at(POST), 'http://www.w3.org/ns/prov#wasAttributedTo').map((o) => o.value)).toEqual([
      `did:pkh:eip155:${CHAIN_ID}:${ATTESTER.toLowerCase()}`,
    ])
    const [created] = objects(at(POST), 'http://www.w3.org/ns/prov#generatedAtTime')
    expect(created?.value).toBe(new Date(PUBLISHED_AT * 1000).toISOString().replace('.000Z', 'Z'))
    expect((created as { datatype: { value: string } }).datatype.value).toBe(`${XSD}dateTime`)
  })

  it('links the seed to its head Version', () => {
    expect(objects(at(POST), `${B}ns#currentVersion`).map((o) => o.value)).toEqual([at(POST_V2)])
    expect(objects(at(POST_V2), `${B}ns#versionOf`).map((o) => o.value)).toEqual([at(POST)])
  })

  it("gives the head Version's newest value from the seed's attester, under the protocol predicate", () => {
    const titles = objects(at(POST), `${B}p/string/title`)
    expect(titles.map((o) => o.value)).toEqual([TITLE])
  })

  it('leaves out a removed value', () => {
    expect(objects(at(POST), `${B}p/string/summary`)).toEqual([])
  })

  it('types values from the EAS type alone', () => {
    const datatype = (predicate: string) =>
      objects(at(POST), predicate).map((o) => [o.value, (o as { datatype: { value: string } }).datatype.value])
    expect(datatype(`${B}p/bool/featured`)).toEqual([['true', `${XSD}boolean`]])
    // A Number is an EAS string (ADR 0010); '1e+21' wouldn't be a valid xsd:decimal anyway
    expect(datatype(`${B}p/string/word_count`)).toEqual([['1e+21', `${XSD}string`]])
    expect(datatype(`${B}p/uint256/published_at`)).toEqual([[String(PUBLISHED_AT), `${XSD}integer`]])
  })

  it('makes a relation the related Seed IRI and a list of relations an RDF list, in order', () => {
    expect(objects(at(POST), `${B}p/bytes32/html`).map((o) => o.value)).toEqual([at(HTML)])
    const store = new Store(parse(toNQuads(graph), 'N-Quads'))
    const [head] = store.getObjects(at(POST), `${B}p/bytes32%5B%5D/author_identity_ids`, null)
    const items: string[] = []
    for (let cell = head; cell && cell.value !== `${RDF}nil`; cell = store.getObjects(cell, `${RDF}rest`, null)[0]) {
      items.push(store.getObjects(cell, `${RDF}first`, null)[0]!.value)
    }
    expect(items).toEqual([at(AUTHOR_1), at(AUTHOR_2)])
  })

  it("gives a storage seed's transaction as an ar:// content IRI beside the attested value", () => {
    expect(objects(at(HTML), `${B}ns#content`).map((o) => o.value)).toEqual([`ar://${TRANSACTION_ID}`])
    expect(objects(at(HTML), `${B}p/string/storage_transaction_id`).map((o) => o.value)).toEqual([TRANSACTION_ID])
    expect(objects(at(HTML), 'https://schema.org/contentUrl')).toEqual([])
  })

  it('adds schema:contentUrl when given a gateway', async () => {
    graph = await exportSeeds([HTML], {
      chainId: CHAIN_ID,
      source: 'local',
      contentUrl: (tx) => `https://arweave.net/${tx}`,
    })
    expect(objects(at(HTML), 'https://schema.org/contentUrl').map((o) => o.value)).toEqual([
      `https://arweave.net/${TRANSACTION_ID}`,
    ])
    expect(objects(at(HTML_V), `${B}ns#versionOf`).map((o) => o.value)).toEqual([at(HTML)])
  })

  it('uses the base it is given', async () => {
    graph = await exportSeeds([POST], { chainId: 10, base: 'https://example.org/seed/', source: 'local' })
    expect(toNQuads(graph)).toContain(`<https://example.org/seed/eas/10/${POST}>`)
    expect(toNQuads(graph)).not.toContain(B)
  })

  it('writes a seed passed twice once', async () => {
    const [entry] = (await exportSeeds([POST], { chainId: CHAIN_ID, source: 'local' })).nodes
    const once = toNQuads(graph)
    graph = await exportSeeds([POST, POST.toUpperCase().replace('0X', '0x'), HTML], { chainId: CHAIN_ID, source: 'local' })
    expect(toNQuads(graph)).toBe(once)
    expect(entry?.id).toBe(at(POST))
  })

  it('refuses a chain id, base or content URL it could not write', () => {
    expect(() => stateGraph([], { chainId: 0 })).toThrow(/chainId/)
    expect(() => stateGraph([], { chainId: 1, base: 'https://example.org/no-slash' })).toThrow(/end with/)
    expect(() => stateGraph([], { chainId: 1, base: 'not an iri/' })).toThrow(/absolute IRI/)
  })
})

describe('writers agree, checked by independent parsers', () => {
  it('N-Quads, Turtle and JSON-LD give the same graph as the RDF/JS quads', async () => {
    const expected = await canonical(toNQuads(graph))
    expect(toQuads(graph).length).toBe(expected.trim().split('\n').length)
    expect(await viaN3(toNQuads(graph), 'N-Quads')).toBe(expected)
    expect(await viaN3(toTurtle(graph), 'Turtle')).toBe(expected)
    const fromJsonLd = (await jsonld.toRDF(toJsonLd(graph) as jsonld.JsonLdDocument, {
      format: 'application/n-quads',
    })) as unknown as string
    expect(await canonical(fromJsonLd)).toBe(expected)
  })

  it('JSON-LD keeps a large integer exact and a boolean as JSON', () => {
    const post = toJsonLd(graph)['@graph'].find((node) => node['@id'] === at(POST))!
    expect(post['p_uint256:published_at']).toEqual({ '@value': String(PUBLISHED_AT), '@type': 'xsd:integer' })
    expect(post['p_bool:featured']).toBe(true)
    expect(post['@type']).toEqual(['seed:Seed', 'c:post'])
  })

  it('the RDF/JS quads compare with equals()', () => {
    const [first, second] = toQuads(graph)
    expect(first!.equals(first!)).toBe(true)
    expect(first!.equals(second!)).toBe(false)
  })

  it('the vocabulary parses as Turtle', () => {
    const vocabulary = parse(seedVocabulary(), 'Turtle')
    expect(vocabulary.map((q) => q.subject.value)).toContain(`${B}ns#currentVersion`)
  })
})

describe('SHACL', () => {
  const shapes = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix seed: <${B}ns#> .
@prefix ex: <https://example.org/shapes#> .

ex:Seed a sh:NodeShape ;
    sh:targetClass seed:Seed ;
    sh:property [ sh:path seed:currentVersion ; sh:minCount 1 ; sh:maxCount 1 ; sh:class seed:Version ] ;
    sh:property [ sh:path prov:generatedAtTime ; sh:maxCount 1 ; sh:datatype xsd:dateTime ] ;
    sh:property [ sh:path prov:wasAttributedTo ; sh:maxCount 1 ; sh:nodeKind sh:IRI ] .

ex:Post a sh:NodeShape ;
    sh:targetClass <${B}c/post> ;
    sh:property [ sh:path <${B}p/string/title> ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ] ;
    sh:property [ sh:path <${B}p/bool/featured> ; sh:datatype xsd:boolean ] ;
    sh:property [ sh:path <${B}p/bytes32/html> ; sh:nodeKind sh:IRI ; sh:class seed:Seed ] .
`
  const validate = (nquads: string) =>
    new SHACLValidator(new Store(parse(shapes, 'Turtle'))).validate(new Store(parse(nquads, 'N-Quads')))

  it('the export conforms to shapes over its own terms', async () => {
    const report = await validate(toNQuads(graph))
    expect(report.results.map((r) => r.message.map((m) => m.value))).toEqual([])
    expect(report.conforms).toBe(true)
  })

  it('the shapes catch a graph that breaks them', async () => {
    const broken = toNQuads(graph).replace(
      `"true"^^<${XSD}boolean>`,
      `"yes"`,
    )
    expect((await validate(broken)).conforms).toBe(false)
  })
})
