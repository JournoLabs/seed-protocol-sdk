import { describe, expect, it } from 'vitest'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'
import {
  buildPropertyModeRows,
  buildSourceModeRows,
  buildSourceOptions,
  buildSyncPreviewBag,
  computeCoverage,
  computeRequiredResolve,
  connectSourceToProperty,
  filterPropertyNames,
  findConflicts,
  originSources,
  previewForEdge,
  syncEdgeIds,
} from '../src/react/fieldMapperCore'

const sources: SourceNode[] = [
  {
    id: 'rss-title',
    label: 'title',
    kind: 'rssField',
    value: 'The grid held, barely',
  },
  {
    id: 'rss-link',
    label: 'link',
    kind: 'rssField',
    value: 'https://example.org/post',
    meta: { url: 'https://example.org/post', class: 'html' },
  },
  {
    id: 'rss-author',
    label: 'creator',
    kind: 'rssField',
    value: 'Ada',
  },
]

const targets: TargetProperty[] = [
  { name: 'title', dataType: 'String', required: true },
  { name: 'html', dataType: 'Html', required: true },
  { name: 'featureImage', dataType: 'Image' },
  { name: 'author', dataType: 'Relation', ref: 'Identity' },
  { name: 'slug', dataType: 'String', required: true },
]

describe('computeRequiredResolve', () => {
  it('requires lookup for relation targets', () => {
    expect(
      computeRequiredResolve(sources[2], targets[3]),
    ).toBe('lookup')
  })

  it('requires extract for URL → Html', () => {
    expect(
      computeRequiredResolve(sources[1], targets[1]),
    ).toBe('extract')
  })

  it('requires file for URL → Image', () => {
    expect(
      computeRequiredResolve(sources[1], targets[2]),
    ).toBe('file')
  })

  it('requires none for plain text → String', () => {
    expect(
      computeRequiredResolve(sources[0], targets[0]),
    ).toBeNull()
  })
})

describe('connectSourceToProperty', () => {
  it('is property-exclusive and auto-attaches lookup', () => {
    const first = connectSourceToProperty(
      [],
      sources,
      targets,
      'rss-author',
      'author',
    )
    expect(first.mappings).toEqual([
      { sourceId: 'rss-author', propertyName: 'author', resolve: 'lookup' },
    ])

    const second = connectSourceToProperty(
      first.mappings,
      sources,
      targets,
      'rss-title',
      'author',
    )
    expect(second.mappings).toEqual([
      { sourceId: 'rss-title', propertyName: 'author', resolve: 'lookup' },
    ])
    expect(second.clearedLookupProps).toEqual([])
  })

  it('normalizes @extract source ids', () => {
    const result = connectSourceToProperty(
      [],
      sources,
      targets,
      'rss-link@extract',
      'html',
    )
    expect(result.mappings).toEqual([
      { sourceId: 'rss-link', propertyName: 'html', resolve: 'extract' },
    ])
  })
})

describe('computeCoverage', () => {
  it('counts mapped props and missing required', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'rss-title', propertyName: 'title' },
    ]
    const coverage = computeCoverage(targets, mappings)
    expect(coverage.mapped).toBe(1)
    expect(coverage.total).toBe(5)
    expect(coverage.missingRequired).toEqual(['html', 'slug'])
  })
})

describe('buildPropertyModeRows', () => {
  it('builds one row per target with preview and state', () => {
    const rows = buildPropertyModeRows({
      targets,
      sources,
      mappings: [
        { sourceId: 'rss-title', propertyName: 'title' },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          // missing extract → needsResolve
        },
      ],
    })
    expect(rows).toHaveLength(5)
    const title = rows.find((r) => r.id === 'title')!
    expect(title.state).toBe('mapped')
    expect(title.preview).toContain('grid held')

    const html = rows.find((r) => r.id === 'html')!
    expect(html.requiredResolve).toBe('extract')
    expect(html.state).toBe('needsResolve')
  })

  it('shows lookup table hits in preview when lookups provided', () => {
    const rows = buildPropertyModeRows({
      targets,
      sources,
      mappings: [
        {
          sourceId: 'rss-author',
          propertyName: 'author',
          resolve: 'lookup',
        },
      ],
      lookups: { author: { Ada: 'seed:identity/ada' } },
    })
    const author = rows.find((r) => r.id === 'author')!
    expect(author.preview).toBe('seed:identity/ada')
    expect(author.sampleValue).toBe('Ada')
    expect(author.state).toBe('mapped')
  })

  it('shows edge lookup hits and needsLookup when unassigned', () => {
    const assigned = buildPropertyModeRows({
      targets,
      sources,
      mappings: [
        {
          sourceId: 'rss-author',
          propertyName: 'author',
          resolve: 'lookup',
          lookup: { entries: [{ value: 'Ada', ref: 'seed:identity/ada' }] },
        },
      ],
    })
    expect(assigned.find((r) => r.id === 'author')?.preview).toBe(
      'seed:identity/ada',
    )
    expect(assigned.find((r) => r.id === 'author')?.state).toBe('mapped')

    const unassigned = buildPropertyModeRows({
      targets,
      sources,
      mappings: [
        {
          sourceId: 'rss-author',
          propertyName: 'author',
          resolve: 'lookup',
        },
      ],
    })
    expect(unassigned.find((r) => r.id === 'author')?.state).toBe('needsLookup')
  })
})

describe('previewForEdge / buildSyncPreviewBag', () => {
  it('coerces copy values like applyMapping', () => {
    const source = sources[0]!
    const target = targets[0]!
    expect(previewForEdge(source, undefined, { target })).toContain(
      'grid held',
    )
  })

  it('keeps extract/file placeholders', () => {
    expect(previewForEdge(sources[1], 'extract')).toMatch(/‹extract/)
    expect(previewForEdge(sources[1], 'file')).toMatch(/‹file/)
  })

  it('shows lookup placeholder until table hit', () => {
    expect(previewForEdge(sources[2], 'lookup', { target: targets[3] })).toMatch(
      /‹lookup ref/,
    )
    expect(
      previewForEdge(sources[2], 'lookup', {
        target: targets[3],
        lookups: { author: { Ada: 'uid-1' } },
        propertyName: 'author',
      }),
    ).toBe('uid-1')
  })

  it('puts lookup hits in the bag and only pending extract/file', () => {
    const bag = buildSyncPreviewBag(
      sources,
      [
        { sourceId: 'rss-title', propertyName: 'title' },
        {
          sourceId: 'rss-author',
          propertyName: 'author',
          resolve: 'lookup',
          lookup: { entries: [{ value: 'Ada', ref: 'uid-1' }] },
        },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'extract',
        },
      ],
      targets,
    )
    expect(bag.title).toBe('The grid held, barely')
    expect(bag.author).toBe('uid-1')
    expect(bag._pendingResolve).toEqual([
      {
        propertyName: 'html',
        sourceId: 'rss-link',
        resolve: 'extract',
      },
    ])
  })
})

describe('buildSourceModeRows / conflicts', () => {
  it('flags duplicate property claims', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'rss-title', propertyName: 'title' },
      { sourceId: 'rss-link', propertyName: 'title' },
    ]
    const { rows, conflicts } = buildSourceModeRows({
      mappings,
      edgeIds: ['e0', 'e1'],
      drafts: [],
      sources,
      targets,
    })
    expect(conflicts.has('e0')).toBe(true)
    expect(conflicts.has('e1')).toBe(true)
    expect(rows.every((r) => r.state === 'conflict')).toBe(true)
  })

  it('includes drafts as empty rows', () => {
    const { rows } = buildSourceModeRows({
      mappings: [],
      edgeIds: [],
      drafts: [{ id: 'd1', sourceId: 'rss-title' }],
      sources,
      targets,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('empty')
    expect(rows[0]!.source?.id).toBe('rss-title')
  })
})

describe('originSources / sourceOptions', () => {
  it('excludes resolved nodes from options', () => {
    const withResolved: SourceNode[] = [
      ...sources,
      {
        id: 'rss-link@extract',
        label: 'link → extract',
        kind: 'resolved',
        value: 'https://example.org/post',
      },
    ]
    expect(originSources(withResolved)).toHaveLength(3)
    expect(buildSourceOptions(withResolved).map((o) => o.value)).toEqual([
      'rss-title',
      'rss-link',
      'rss-author',
    ])
  })
})

describe('filterPropertyNames', () => {
  it('defaults to mapped + required', () => {
    const names = filterPropertyNames(
      targets,
      [{ sourceId: 'rss-title', propertyName: 'title' }],
      'requiredAndMapped',
      new Set(),
    )
    expect(names).toEqual(new Set(['title', 'html', 'slug']))
  })

  it('returns null for all', () => {
    expect(
      filterPropertyNames(targets, [], 'all', new Set()),
    ).toBeNull()
  })
})

describe('findConflicts / syncEdgeIds', () => {
  it('findConflicts marks later duplicates', () => {
    const set = findConflicts([
      { id: 'a', propertyName: 'title' },
      { id: 'b', propertyName: 'html' },
      { id: 'c', propertyName: 'title' },
    ])
    expect([...set].sort()).toEqual(['a', 'c'])
  })

  it('syncEdgeIds grows and shrinks', () => {
    const grown = syncEdgeIds(['e0'], 3)
    expect(grown).toHaveLength(3)
    expect(grown[0]).toBe('e0')
    expect(syncEdgeIds(grown, 1)).toEqual(['e0'])
  })
})
