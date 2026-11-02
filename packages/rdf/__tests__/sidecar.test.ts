import { describe, expect, it } from 'vitest'
import jsonld from 'jsonld'
import {
  PROVISIONAL_BASE_IRI as B,
  checkSidecar,
  sidecarContext,
  suggestTerms,
  syncSidecar,
  type RdfSidecar,
  type SidecarSchema,
} from '../src/index'

const SCHEMA = 'https://schema.org/'

const schema: SidecarSchema = {
  id: 'schema-1',
  version: 3,
  models: {
    Post: {
      id: 'model-post',
      properties: {
        title: { id: 'prop-title', type: 'Text' },
        publishedAt: { id: 'prop-published', type: 'Date' },
        html: { id: 'prop-html', type: 'Html' },
        authors: { id: 'prop-authors', type: 'List', ref: 'Identity' },
        slug: { id: 'prop-slug', type: 'Text' },
      },
    },
    Identity: { id: 'model-identity', properties: { displayName: { id: 'prop-name', type: 'Text' } } },
    Note: { properties: { body: { type: 'Text' } } },
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
    'prop-name': 'schema:name',
  },
}

describe('sidecarContext', () => {
  it('writes a type-scoped context from the terms and the current names', () => {
    expect(sidecarContext({ schema, sidecar })).toEqual({
      '@version': 1.1,
      schema: SCHEMA,
      dcterms: 'http://purl.org/dc/terms/',
      Post: {
        '@id': 'schema:BlogPosting',
        '@context': {
          title: 'schema:headline',
          publishedAt: { '@id': 'schema:datePublished', '@type': 'http://www.w3.org/2001/XMLSchema#dateTime' },
          html: { '@id': 'schema:articleBody', '@type': '@id' },
          authors: { '@id': 'dcterms:creator', '@type': '@id', '@container': '@list' },
        },
      },
      Identity: { '@id': `${B}c/identity`, '@context': { displayName: 'schema:name' } },
    })
  })

  it('follows a rename, because terms are keyed by id', () => {
    const { title, ...rest } = schema.models.Post!.properties
    const renamed = { ...schema, models: { ...schema.models, Post: { ...schema.models.Post!, properties: { headline: title!, ...rest } } } }
    const context = sidecarContext({ schema: renamed, sidecar }) as { Post: { '@context': Record<string, unknown> } }
    expect(context.Post['@context'].headline).toBe('schema:headline')
    expect(context.Post['@context'].title).toBeUndefined()
  })

  it('expands a document written with local names to the mapped IRIs', async () => {
    const context = sidecarContext({ schema, sidecar })
    const doc = {
      '@context': context,
      '@id': 'https://example.org/post',
      '@type': 'Post',
      title: 'Hello',
      publishedAt: '2026-10-20T14:03:11Z',
      authors: ['https://example.org/a', 'https://example.org/b'],
    }
    const quads = (await jsonld.toRDF(doc as jsonld.JsonLdDocument, { format: 'application/n-quads' })) as unknown as string
    expect(quads).toContain(`<https://example.org/post> <${SCHEMA}headline> "Hello" .`)
    expect(quads).toContain(`<${SCHEMA}datePublished> "2026-10-20T14:03:11Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`)
    expect(quads).toContain(`<https://example.org/post> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${SCHEMA}BlogPosting>`)
    expect(quads).toMatch(/<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#first> <https:\/\/example\.org\/a>/)
  })
})

describe('checkSidecar', () => {
  it('finds nothing to fix in a synced sidecar, and lists what has no term', () => {
    const report = checkSidecar({ schema, sidecar: syncSidecar({ schema, sidecar }) })
    expect(report.stale).toEqual([])
    expect(report.invalid).toEqual([])
    expect(report.contextOutdated).toBe(false)
    expect(report.versionOutdated).toBe(false)
    expect(report.unmapped).toEqual([
      { model: 'Post', property: 'slug', id: 'prop-slug' },
      { model: 'Identity', id: 'model-identity' },
      { model: 'Note', id: undefined },
      { model: 'Note', property: 'body', id: undefined },
    ])
  })

  it('reports terms for ids the schema no longer has, and terms it cannot expand', () => {
    const report = checkSidecar({
      schema,
      sidecar: { ...sidecar, terms: { ...sidecar.terms, 'prop-gone': 'schema:gone', 'prop-slug': 'nope:slug' } },
    })
    expect(report.stale).toEqual([{ id: 'prop-gone', term: 'schema:gone' }])
    expect(report.invalid).toEqual([{ id: 'prop-slug', term: 'nope:slug' }])
  })

  it('reports a context and version left behind by a rename', () => {
    const synced = syncSidecar({ schema, sidecar })
    const { title, ...rest } = schema.models.Post!.properties
    const renamed = {
      ...schema,
      version: 4,
      models: { ...schema.models, Post: { ...schema.models.Post!, properties: { headline: title!, ...rest } } },
    }
    const report = checkSidecar({ schema: renamed, sidecar: synced })
    expect(report.contextOutdated).toBe(true)
    expect(report.versionOutdated).toBe(true)
    expect(report.stale).toEqual([])
  })

  it('refuses a sidecar written for another schema', () => {
    expect(() => checkSidecar({ schema, sidecar: { ...sidecar, schemaId: 'other' } })).toThrow(/schema other/)
  })
})

describe('syncSidecar', () => {
  it('rewrites the context and schemaVersion and keeps every term, stale ones too', () => {
    const terms = { ...sidecar.terms, 'prop-gone': 'schema:gone' }
    const synced = syncSidecar({ schema, sidecar: { ...sidecar, terms, schemaVersion: 1 } })
    expect(synced.schemaVersion).toBe(3)
    expect(synced.terms).toEqual(terms)
    expect(synced['@context']).toEqual(sidecarContext({ schema, sidecar }))
  })
})

describe('suggestTerms', () => {
  it('drafts terms for unmapped names with a common meaning', () => {
    const blank = { schemaId: 'schema-1', terms: {} }
    expect(suggestTerms({ schema, sidecar: blank })).toEqual([
      { model: 'Post', id: 'model-post', term: 'schema:BlogPosting' },
      { model: 'Post', property: 'title', id: 'prop-title', term: 'dcterms:title' },
      { model: 'Post', property: 'publishedAt', id: 'prop-published', term: 'dcterms:issued' },
      { model: 'Post', property: 'html', id: 'prop-html', term: 'schema:text' },
      { model: 'Post', property: 'authors', id: 'prop-authors', term: 'dcterms:creator' },
    ])
  })

  it('leaves mapped ones alone', () => {
    expect(suggestTerms({ schema, sidecar })).toEqual([])
  })
})
