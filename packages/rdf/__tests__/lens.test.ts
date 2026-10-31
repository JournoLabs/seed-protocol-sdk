import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Parser, Store } from 'n3'
import jsonld from 'jsonld'
import { canonize } from 'rdf-canonize'
import SHACLValidator from 'rdf-validate-shacl'
import { clearLocalQuerySource, registerLocalQuerySource } from '@seedprotocol/query'
import {
  PROVISIONAL_BASE_IRI as B,
  exportSeeds,
  toJsonLd,
  toNQuads,
  toTurtle,
  type LensSchema,
  type RdfSidecar,
  type StateGraph,
} from '../src/index'
import { CHAIN_ID, HTML, POST, PUBLISHED_AT, TITLE, chain, localSource } from './fixtures'

const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const SCHEMA = 'https://schema.org/'
const at = (uid: string) => `${B}eas/${CHAIN_ID}/${uid}`

const schema: LensSchema = {
  id: 'schema-1',
  models: {
    Post: {
      id: 'model-post',
      properties: {
        title: { id: 'prop-title', type: 'Text' },
        wordCount: { id: 'prop-words', type: 'Number' },
        publishedAt: { id: 'prop-published', type: 'Date' },
        featured: { id: 'prop-featured', type: 'Boolean' },
        html: { id: 'prop-html', type: 'Html' },
        authors: { id: 'prop-authors', type: 'List', ref: 'Identity' },
      },
    },
    Page: { id: 'model-page', properties: { title: { id: 'prop-page-title', type: 'Text' } } },
  },
}

const sidecar: RdfSidecar = {
  schemaId: 'schema-1',
  '@context': { '@version': 1.1, schema: SCHEMA, dcterms: 'http://purl.org/dc/terms/' },
  terms: {
    'model-post': 'schema:BlogPosting',
    'prop-title': 'schema:headline',
    'prop-published': 'schema:datePublished',
    'prop-html': 'schema:articleBody',
    'prop-authors': 'dcterms:creator',
    'prop-page-title': 'schema:name',
  },
}

const lensExport = (lens: { schema: LensSchema; sidecar: RdfSidecar } = { schema, sidecar }) =>
  exportSeeds([POST, HTML], { chainId: CHAIN_ID, source: 'local', lens })

const store = (graph: StateGraph) => new Store(new Parser({ format: 'N-Quads' }).parse(toNQuads(graph)))
const typed = (graph: StateGraph, predicate: string) =>
  store(graph)
    .getObjects(at(POST), predicate, null)
    .map((o) => [o.value, (o as { datatype: { value: string } }).datatype.value])

beforeEach(() => registerLocalQuerySource(localSource()))
afterEach(() => clearLocalQuerySource())

describe('lens', () => {
  it('replaces the protocol class and predicates it maps, and leaves the rest', async () => {
    const graph = await lensExport()
    const s = store(graph)
    expect(s.getObjects(at(POST), `${RDF}type`, null).map((o) => o.value).sort()).toEqual([`${SCHEMA}BlogPosting`, `${B}ns#Seed`])
    expect(s.getObjects(at(POST), `${SCHEMA}headline`, null).map((o) => o.value)).toEqual([TITLE])
    expect(s.getObjects(at(POST), `${B}p/string/title`, null)).toEqual([])
    expect(s.getObjects(at(POST), `${B}p/bool/featured`, null).map((o) => o.value)).toEqual(['true'])
    expect(s.getObjects(at(POST), `${SCHEMA}articleBody`, null).map((o) => o.value)).toEqual([at(HTML)])
    expect(s.getObjects(at(POST), 'http://purl.org/dc/terms/creator', null)).toHaveLength(1)
    expect(s.getObjects(at(HTML), `${RDF}type`, null).map((o) => o.value)).toContain(`${B}c/html`)
    expect(graph.warnings).toEqual([])
  })

  it('types a Date as xsd:dateTime and a Number by its value', async () => {
    const graph = await lensExport()
    expect(typed(graph, `${SCHEMA}datePublished`)).toEqual([
      [new Date(PUBLISHED_AT * 1000).toISOString().replace('.000Z', 'Z'), `${XSD}dateTime`],
    ])
    expect(typed(graph, `${B}p/string/word_count`)).toEqual([['1.0E21', `${XSD}double`]])
  })

  it.each([
    ['1500', '1500', 'integer'],
    ['-2.5', '-2.5', 'decimal'],
    ['1e+21', '1.0E21', 'double'],
    ['1.5e-7', '1.5E-7', 'double'],
  ])('types the Number %s as %s, xsd:%s', async (value, lexical, datatype) => {
    const data = chain()
    const words = data.properties.find((p) => p.decodedDataJson.includes('word_count'))!
    words.decodedDataJson = words.decodedDataJson.replaceAll('1e+21', value)
    registerLocalQuerySource(localSource(data))
    expect(typed(await lensExport(), `${B}p/string/word_count`)).toEqual([[lexical, `${XSD}${datatype}`]])
  })

  it('keeps a Number that is not one as a string, and warns', async () => {
    const data = chain()
    const words = data.properties.find((p) => p.decodedDataJson.includes('word_count'))!
    words.decodedDataJson = words.decodedDataJson.replaceAll('1e+21', 'many')
    registerLocalQuerySource(localSource(data))
    const graph = await lensExport()
    expect(typed(graph, `${B}p/string/word_count`)).toEqual([['many', `${XSD}string`]])
    expect(graph.warnings).toEqual([`"many" isn't a number; exported as a string`])
  })

  it('follows a renamed model and property by id', async () => {
    const { title, ...rest } = schema.models.Post!.properties
    // The on-chain name still matches `titles` loosely; the term follows the id, not the key.
    const renamed: LensSchema = {
      ...schema,
      models: { ...schema.models, Post: { ...schema.models.Post!, properties: { ...rest, titles: title! } } },
    }
    const graph = await lensExport({ schema: renamed, sidecar })
    expect(store(graph).getObjects(at(POST), `${SCHEMA}headline`, null).map((o) => o.value)).toEqual([TITLE])
  })

  it('keeps the protocol predicate where nameMatch refuses the loose name', async () => {
    const { title, ...rest } = schema.models.Post!.properties
    const strict: LensSchema = {
      ...schema,
      nameMatch: 'exact',
      models: { ...schema.models, Post: { ...schema.models.Post!, properties: { ...rest, titles: title! } } },
    }
    const graph = await lensExport({ schema: strict, sidecar })
    expect(store(graph).getObjects(at(POST), `${B}p/string/title`, null).map((o) => o.value)).toEqual([TITLE])
  })

  it('warns on a term it can use nowhere and exports the rest', async () => {
    const graph = await lensExport({
      schema,
      sidecar: { ...sidecar, terms: { ...sidecar.terms, 'prop-gone': 'schema:gone', 'prop-featured': 'nope:featured' } },
    })
    expect(graph.warnings).toEqual([
      `Term "nope:featured" for prop-featured isn't an IRI or a name with a known prefix`,
      `Term "schema:gone" names prop-gone, which is no model or property in the schema`,
    ])
    expect(store(graph).getObjects(at(POST), `${B}p/bool/featured`, null)).toHaveLength(1)
  })

  it('warns on a property two schema properties match equally', async () => {
    const ambiguous: LensSchema = {
      ...schema,
      models: {
        ...schema.models,
        Post: { properties: { ...schema.models.Post!.properties, Title: { type: 'Text' }, title_: { type: 'Text' } } },
      },
    }
    const graph = await lensExport({ schema: { ...ambiguous, nameMatch: 'normalized' }, sidecar: { ...sidecar, terms: {} } })
    expect(graph.warnings.join()).toMatch(/matches several/)
  })

  it('refuses a sidecar written for another schema', async () => {
    await expect(lensExport({ schema, sidecar: { ...sidecar, schemaId: 'other' } })).rejects.toThrow(/schema other/)
  })

  it('accepts an absolute IRI as a term', async () => {
    const graph = await lensExport({ schema, sidecar: { ...sidecar, terms: { 'prop-title': 'https://example.org/title' } } })
    expect(store(graph).getObjects(at(POST), 'https://example.org/title', null)).toHaveLength(1)
  })
})

describe('lens output, checked by independent parsers', () => {
  const canonical = (nquads: string): Promise<string> =>
    canonize(nquads, { algorithm: 'RDFC-1.0', inputFormat: 'application/n-quads' })

  it('Turtle and JSON-LD give the same graph as N-Quads', async () => {
    const graph = await lensExport()
    const expected = await canonical(toNQuads(graph))
    const turtle = toTurtle(graph)
    expect(turtle).toContain('@prefix dcterms:')
    expect(turtle).toContain('schema:headline')
    const fromTurtle = new Store(new Parser({ format: 'Turtle' }).parse(turtle))
    expect(fromTurtle.size).toBe(store(graph).size)
    const fromJsonLd = (await jsonld.toRDF(toJsonLd(graph) as jsonld.JsonLdDocument, {
      format: 'application/n-quads',
    })) as unknown as string
    expect(await canonical(fromJsonLd)).toBe(expected)
  })

  it('conforms to SHACL shapes over the mapped terms', async () => {
    const shapes = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix schema: <${SCHEMA}> .
<https://example.org/Post> a sh:NodeShape ;
    sh:targetClass schema:BlogPosting ;
    sh:property [ sh:path schema:headline ; sh:minCount 1 ; sh:datatype xsd:string ] ;
    sh:property [ sh:path schema:datePublished ; sh:minCount 1 ; sh:datatype xsd:dateTime ] ;
    sh:property [ sh:path <${B}p/string/word_count> ; sh:datatype xsd:double ] .
`
    const report = await new SHACLValidator(new Store(new Parser({ format: 'Turtle' }).parse(shapes))).validate(
      store(await lensExport()),
    )
    expect(report.results.map((r) => r.message.map((m) => m.value))).toEqual([])
    expect(report.conforms).toBe(true)
  })
})
