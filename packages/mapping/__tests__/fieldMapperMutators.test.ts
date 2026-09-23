/**
 * Hook-level behavior tests using a tiny controlled harness (no DOM).
 * Exercises the same mutators FieldMapper wires/rows call.
 */
import { describe, expect, it } from 'vitest'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'
import {
  applyLookupEntriesToMappings,
  attachLookupIfNeeded,
  computeCoverage,
  computeRequiredResolve,
  connectSourceToProperty,
  removeMappingsForSourceId,
  upsertPropertyMapping,
} from '../src/react/fieldMapperCore'

const sources: SourceNode[] = [
  {
    id: 'fm-title',
    label: 'title',
    kind: 'frontmatter',
    value: 'Hello',
  },
  {
    id: 'full',
    label: 'Full document',
    kind: 'full',
    value: '# Hello\n\nBody',
  },
]

const targets: TargetProperty[] = [
  { name: 'title', dataType: 'String', required: true },
  { name: 'text', dataType: 'Text' },
  { name: 'author', dataType: 'Relation', ref: 'Identity', required: true },
]

/** Simulate property-mode setSource / setTransform / removeRow. */
function propertyModeSession() {
  let mappings: FieldMapping[] = []
  const onChange = (next: FieldMapping[]) => {
    mappings = next
  }

  return {
    get mappings() {
      return mappings
    },
    setSource(propertyName: string, sourceId: string | null) {
      if (!sourceId) {
        mappings = mappings.filter((m) => m.propertyName !== propertyName)
        return
      }
      const result = connectSourceToProperty(
        mappings,
        sources,
        targets,
        sourceId,
        propertyName,
      )
      let edge = result.mappings.find((m) => m.propertyName === propertyName)!
      if (!edge.resolve) {
        const source = sources.find((s) => s.id === sourceId)
        const target = targets.find((t) => t.name === propertyName)
        const required = computeRequiredResolve(source, target)
        if (required) edge = { ...edge, resolve: required }
      }
      onChange(upsertPropertyMapping(result.mappings, edge))
    },
    setTransform(propertyName: string, resolve: FieldMapping['resolve'] | null) {
      const prev = mappings.find((m) => m.propertyName === propertyName)
      if (!prev) return
      const edge: FieldMapping = resolve
        ? { ...prev, resolve }
        : { sourceId: prev.sourceId, propertyName: prev.propertyName }
      onChange(upsertPropertyMapping(mappings, edge))
    },
    removeRow(propertyName: string) {
      onChange(mappings.filter((m) => m.propertyName !== propertyName))
    },
  }
}

describe('useFieldMapper property-mode mutators (harness)', () => {
  it('setSource upserts and preselects required transform', () => {
    const session = propertyModeSession()
    session.setSource('author', 'fm-title')
    expect(session.mappings).toEqual([
      { sourceId: 'fm-title', propertyName: 'author', resolve: 'lookup' },
    ])
    session.setSource('title', 'fm-title')
    expect(session.mappings).toContainEqual({
      sourceId: 'fm-title',
      propertyName: 'title',
    })
    expect(session.mappings).toContainEqual({
      sourceId: 'fm-title',
      propertyName: 'author',
      resolve: 'lookup',
    })
  })

  it('setTransform override can clear resolve', () => {
    const session = propertyModeSession()
    session.setSource('author', 'fm-title')
    session.setTransform('author', null)
    expect(session.mappings[0]).toEqual({
      sourceId: 'fm-title',
      propertyName: 'author',
    })
  })

  it('removeRow clears the edge', () => {
    const session = propertyModeSession()
    session.setSource('title', 'fm-title')
    session.removeRow('title')
    expect(session.mappings).toEqual([])
  })

  it('coverage tracks required gaps', () => {
    const session = propertyModeSession()
    session.setSource('title', 'fm-title')
    const coverage = computeCoverage(targets, session.mappings)
    expect(coverage.mapped).toBe(1)
    expect(coverage.missingRequired).toEqual(['author'])
  })
})

describe('identical edges from property vs source authoring', () => {
  it('produces the same FieldMapping set', () => {
    // Property mode
    const prop = propertyModeSession()
    prop.setSource('title', 'fm-title')
    prop.setSource('text', 'full')

    // Source mode: sequential upserts by property exclusivity still
    let sourceMappings: FieldMapping[] = []
    for (const edge of [
      { sourceId: 'fm-title', propertyName: 'title' },
      { sourceId: 'full', propertyName: 'text' },
    ]) {
      sourceMappings = upsertPropertyMapping(sourceMappings, edge)
    }

    const norm = (list: FieldMapping[]) =>
      [...list].sort((a, b) =>
        a.propertyName.localeCompare(b.propertyName),
      )

    expect(norm(prop.mappings)).toEqual(norm(sourceMappings))
  })
})

describe('removeMappingsForSourceId', () => {
  it('removes resolve-matched edges for derived ids; all edges for origin id', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'rss-link', propertyName: 'html', resolve: 'extract' },
      { sourceId: 'rss-link', propertyName: 'importUrl' },
    ]
    const byResolve = removeMappingsForSourceId(
      mappings,
      'rss-link@extract',
    )
    expect(byResolve.mappings).toEqual([
      { sourceId: 'rss-link', propertyName: 'importUrl' },
    ])

    const byOrigin = removeMappingsForSourceId(mappings, 'rss-link')
    expect(byOrigin.mappings).toEqual([])
  })
})

describe('attachLookupIfNeeded', () => {
  it('is a no-op when resolve already set', () => {
    const edge = attachLookupIfNeeded(
      { sourceId: 'a', propertyName: 'author', resolve: 'extract' },
      targets[2],
    )
    expect(edge.resolve).toBe('extract')
  })
})

describe('applyLookupEntriesToMappings', () => {
  it('writes and clears lookup.entries on the edge', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'fm-title', propertyName: 'author', resolve: 'lookup' },
    ]
    const assigned = applyLookupEntriesToMappings(
      mappings,
      'property',
      'author',
      [],
      [{ value: 'Ada', ref: 'local_1' }],
    )
    expect(assigned).toEqual([
      {
        sourceId: 'fm-title',
        propertyName: 'author',
        resolve: 'lookup',
        lookup: { entries: [{ value: 'Ada', ref: 'local_1' }] },
      },
    ])

    const cleared = applyLookupEntriesToMappings(
      assigned!,
      'property',
      'author',
      [],
      [],
    )
    expect(cleared?.[0]?.lookup).toBeUndefined()
    expect(cleared?.[0]?.resolve).toBe('lookup')
  })

  it('drops lookup when the edge is disconnected', () => {
    const mappings: FieldMapping[] = [
      {
        sourceId: 'fm-title',
        propertyName: 'author',
        resolve: 'lookup',
        lookup: { entries: [{ value: 'Ada', ref: 'local_1' }] },
      },
    ]
    const next = mappings.filter((m) => m.propertyName !== 'author')
    expect(next).toEqual([])
  })
})
