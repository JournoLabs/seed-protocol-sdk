// A document saved before 0.8.0 kept its lookups in `MappingDocument.lookups`, keyed by property
// name. 0.8.0 reads only `lookup.entries` on each edge, so without a migration every value in the
// old table showed up as a miss (batch 16 item 25).
import { describe, expect, it } from 'vitest'
import { migrateMappingLookups } from '../src'

const doc = {
  version: 1 as const,
  sourceKind: 'rss' as const,
  mappings: [
    { sourceId: 'rss-author', propertyName: 'authors', resolve: 'lookup' as const, lookup: { entries: [{ value: 'Mira Chen', refs: ['mira-edge'] }] } },
    { sourceId: 'rss-title', propertyName: 'title' },
  ],
  lookups: {
    authors: { 'Mira Chen': 'mira-table', 'Sam  Ortiz': ['sam', 'sam-2'] },
    editor: { Ada: 'ada' },
  },
}

describe('migrateMappingLookups', () => {
  it("moves each property's table onto its lookup edge, the edge's own entry winning", () => {
    const { document, unused } = migrateMappingLookups(doc)
    expect(document).toEqual({
      version: 1,
      sourceKind: 'rss',
      mappings: [
        {
          sourceId: 'rss-author',
          propertyName: 'authors',
          resolve: 'lookup',
          lookup: { entries: [{ value: 'Mira Chen', refs: ['mira-edge'] }, { value: 'Sam Ortiz', refs: ['sam', 'sam-2'] }] },
        },
        { sourceId: 'rss-title', propertyName: 'title' },
      ],
    })
    expect(unused).toEqual(['editor'])
  })

  it('returns a document without a table as it is', () => {
    const { lookups: _lookups, ...plain } = doc
    expect(migrateMappingLookups(plain)).toEqual({ document: plain, unused: [] })
  })
})
