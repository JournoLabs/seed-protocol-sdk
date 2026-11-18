import { describe, expect, it } from 'vitest'
import { checkSidecar, suggestTerms, syncSidecar, type SidecarSchema } from '../src/index'
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
