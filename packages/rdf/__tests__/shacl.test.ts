import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Parser, Store } from 'n3'
import SHACLValidator from 'rdf-validate-shacl'
import { clearLocalQuerySource, registerLocalQuerySource } from '@seedprotocol/query'
import {
  PROVISIONAL_BASE_IRI as B,
  exportSeeds,
  toNQuads,
  toShacl,
  type LensSchema,
  type RdfLens,
  type RdfSidecar,
} from '../src/index'
import { CHAIN_ID, HTML, POST, chain, localSource } from './fixtures'

const SH = 'http://www.w3.org/ns/shacl#'
const SCHEMA = 'https://schema.org/'

const schema: LensSchema = {
  id: 'schema-1',
  models: {
    Post: {
      id: 'model-post',
      properties: {
        title: { id: 'prop-title', type: 'Text', required: true },
        wordCount: { id: 'prop-words', type: 'Number' },
        publishedAt: { id: 'prop-published', type: 'Date' },
        featured: { id: 'prop-featured', type: 'Boolean' },
        html: { id: 'prop-html', type: 'Html' },
        authors: { id: 'prop-authors', type: 'List', ref: 'Identity' },
      },
    },
  },
}

const sidecar: RdfSidecar = {
  schemaId: 'schema-1',
  '@context': { schema: SCHEMA },
  terms: { 'model-post': 'schema:BlogPosting', 'prop-title': 'schema:headline', 'prop-authors': 'schema:author' },
}

const parse = (text: string, format: string) => new Parser({ format }).parse(text)

async function validate(lens: RdfLens, data = chain()) {
  registerLocalQuerySource(localSource(data))
  const graph = await exportSeeds([POST, HTML], { chainId: CHAIN_ID, source: 'local', lens })
  const shapes = new Store(parse(toShacl(lens), 'Turtle'))
  const report = await new SHACLValidator(shapes).validate(new Store(parse(toNQuads(graph), 'N-Quads')))
  return { conforms: report.conforms, paths: report.results.map((r) => r.path?.value) }
}

const withValue = (name: string, value: unknown) => {
  const data = chain()
  const property = data.properties.find((p) => p.decodedDataJson.includes(`"${name}"`))!
  const [entry] = JSON.parse(property.decodedDataJson)
  property.decodedDataJson = JSON.stringify([{ ...entry, value: { ...entry.value, value } }])
  return data
}

beforeEach(() => registerLocalQuerySource(localSource()))
afterEach(() => clearLocalQuerySource())

describe('toShacl', () => {
  it('writes one node shape per model, targeting the class the export gives it', () => {
    const store = new Store(parse(toShacl({ schema, sidecar }), 'Turtle'))
    expect(store.getObjects(null, `${SH}targetClass`, null).map((o) => o.value)).toEqual([`${SCHEMA}BlogPosting`])
    const paths = store.getObjects(null, `${SH}path`, null).filter((o) => o.termType === 'NamedNode').map((o) => o.value)
    expect(paths).toEqual(
      expect.arrayContaining([`${SCHEMA}headline`, `${B}p/string/word_count`, `${B}p/bytes32/html`, `${SCHEMA}author`]),
    )
  })

  it('targets the protocol class and predicates without terms', () => {
    const store = new Store(parse(toShacl({ schema, sidecar: { schemaId: 'schema-1', terms: {} } }), 'Turtle'))
    expect(store.getObjects(null, `${SH}targetClass`, null).map((o) => o.value)).toEqual([`${B}c/post`])
    expect(store.getObjects(null, `${SH}path`, null).map((o) => o.value)).toContain(`${B}p/bytes32%5B%5D/author_identity_ids`)
  })

  it('accepts the export made with the same lens', async () => {
    expect(await validate({ schema, sidecar })).toEqual({ conforms: true, paths: [] })
    expect(await validate({ schema, sidecar: { schemaId: 'schema-1', terms: {} } })).toEqual({ conforms: true, paths: [] })
  })

  it('reports a required property that is missing', async () => {
    const data = chain()
    data.properties = data.properties.filter((p) => !p.decodedDataJson.includes('"title"'))
    expect(await validate({ schema, sidecar }, data)).toEqual({ conforms: false, paths: [`${SCHEMA}headline`] })
  })

  it('reports a Number that is not one', async () => {
    const { conforms, paths } = await validate({ schema, sidecar }, withValue('word_count', 'many'))
    expect(conforms).toBe(false)
    expect(paths).toEqual([`${B}p/string/word_count`])
  })

  it('reports a relation list member that is not an IRI', async () => {
    const lens = { schema, sidecar }
    registerLocalQuerySource(localSource())
    const graph = await exportSeeds([POST], { chainId: CHAIN_ID, source: 'local', lens })
    // Swap the list's first member for a literal.
    const nquads = toNQuads(graph).replace(
      /(_:\S+ <http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#first> )<[^>]+>/,
      '$1"not a seed"',
    )
    const report = await new SHACLValidator(new Store(parse(toShacl(lens), 'Turtle'))).validate(
      new Store(parse(nquads, 'N-Quads')),
    )
    expect(report.conforms).toBe(false)
  })

  it('refuses a sidecar written for another schema', () => {
    expect(() => toShacl({ schema, sidecar: { ...sidecar, schemaId: 'other' } })).toThrow(/schema other/)
  })
})
