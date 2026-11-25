import { describe, expect, it } from 'vitest'
import { checkSidecar, suggestTerms, syncSidecar, toShacl, type SidecarSchema } from '../src/index'
import { compileLens } from '../src/lens'
import { withSchemaIds } from '../src/schemaIds'

// A schema file as the docs' tutorial writes it: names only.
const handWritten: SidecarSchema = {
  metadata: { name: 'Blog' },
  models: { Post: { properties: { title: { type: 'Text' } } } },
}

describe('schema files without ids', () => {
  it('get the ids the SDK derives from the names', () => {
    // The SDK's schemaApply test checks the same vector.
    const filled = withSchemaIds(handWritten)
    expect(filled.id).toBe('5945b0f13a')
    expect(filled.models.Post!.id).toBe('313a8733b8')
    expect(filled.models.Post!.properties.title!.id).toBe('d594dfebd3')
  })

  it('keep the ids they have', () => {
    const partial: SidecarSchema = {
      id: 'kept-schema',
      metadata: { name: 'Blog' },
      models: { Post: { id: 'kept-model', properties: { title: { type: 'Text' } } } },
    }
    const filled = withSchemaIds(partial)
    expect([filled.id, filled.models.Post!.id, filled.models.Post!.properties.title!.id]).toEqual([
      'kept-schema',
      'kept-model',
      'd594dfebd3',
    ])
  })

  it('check, sync and suggest against a sidecar written for the derived ids', () => {
    const sidecar = { schemaId: '5945b0f13a', '@context': { schema: 'https://schema.org/' }, terms: { '313a8733b8': 'schema:BlogPosting' } }
    const report = checkSidecar({ schema: handWritten, sidecar: syncSidecar({ schema: handWritten, sidecar }) })
    expect(report.stale).toEqual([])
    expect(report.unmapped).toEqual([{ model: 'Post', property: 'title', id: 'd594dfebd3' }])
    expect(suggestTerms({ schema: handWritten, sidecar })).toEqual([
      { model: 'Post', property: 'title', id: 'd594dfebd3', term: 'dcterms:title' },
    ])
  })
})

describe('a sidecar for another schema', () => {
  const sidecar = { schemaId: 'other', terms: {} }

  it('names a derived schema id as derived, in every entry point that checks it', () => {
    expect(() => checkSidecar({ schema: handWritten, sidecar })).toThrow(/not 5945b0f13a \(derived from metadata\.name\)/)
    expect(() => toShacl({ schema: handWritten, sidecar })).toThrow(/not 5945b0f13a \(derived from metadata\.name\)/)
    expect(() => compileLens({ schema: handWritten, sidecar })).toThrow(/not 5945b0f13a \(derived from metadata\.name\)/)
  })

  it("doesn't call an id from the file derived", () => {
    expect(() => checkSidecar({ schema: { id: 'schema-1', models: {} }, sidecar })).toThrow('The sidecar is for schema other, not schema-1')
  })
})

describe('the report on a schema with derived ids', () => {
  const terms = (...ids: string[]) => ({ schemaId: '5945b0f13a', terms: Object.fromEntries(ids.map((id) => [id, 'schema:x'])) })

  it('flags a sidecar whose every term is stale', () => {
    expect(checkSidecar({ schema: handWritten, sidecar: terms('a', 'b') }).derivedIdsMismatch).toBe(true)
  })

  it('does not when some term matches, when there are no terms, or when the file has its ids', () => {
    expect(checkSidecar({ schema: handWritten, sidecar: terms('a', '313a8733b8') }).derivedIdsMismatch).toBe(false)
    expect(checkSidecar({ schema: handWritten, sidecar: terms() }).derivedIdsMismatch).toBe(false)
    const withIds = { id: 'schema-1', models: { Post: { id: 'm', properties: {} } } }
    expect(checkSidecar({ schema: withIds, sidecar: { schemaId: 'schema-1', terms: { a: 'schema:x' } } }).derivedIdsMismatch).toBe(false)
  })
})
