import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FieldMapping, LookupEntry, SourceNode, TargetProperty } from '../src/types'
import { FieldMapper } from '../src/react/FieldMapper'
import { previewForEdge, rowState } from '../src/react/fieldMapperCore'
import type { FieldMapperLookupRow } from '../src/react/fieldMapperTypes'

const sources: SourceNode[] = [
  {
    id: 'rss-author',
    label: 'author',
    kind: 'rssField',
    value: 'Mira Chen',
  },
  {
    id: 'rss-title',
    label: 'title',
    kind: 'rssField',
    value: 'Hello',
  },
  {
    id: 'rss-link',
    label: 'link',
    kind: 'rssField',
    value: 'https://example.org/post',
    meta: { url: 'https://example.org/post', class: 'html' },
  },
]

const targets: TargetProperty[] = [
  {
    name: 'authors',
    dataType: 'List',
    refValueType: 'Relation',
    ref: 'Identity',
  },
  { name: 'title', dataType: 'String' },
  { name: 'html', dataType: 'Html' },
]

describe('the package lookup editor', () => {
  const render = (lookups: 'section' | false) =>
    renderToStaticMarkup(
      React.createElement(FieldMapper, {
        sources,
        targets,
        mappings: [{ sourceId: 'rss-author', propertyName: 'authors', resolve: 'lookup' }],
        onChange: () => {},
        theme: 'none',
        defaultRows: 'all',
        slots: { lookups },
      }),
    )

  it('shows without renderLookup, and slots.lookups false hides it', () => {
    expect(render('section')).toContain('Relation lookups')
    expect(render(false)).not.toContain('Relation lookups')
  })
})

describe('a source that repeats', () => {
  const byline: SourceNode = {
    id: 'rss-author',
    label: 'author',
    kind: 'rssField',
    value: 'Mira Chen',
    values: ['Mira Chen', 'Sam Ortiz'],
  }
  const mapping = (entries: LookupEntry[]): FieldMapping => ({
    sourceId: 'rss-author',
    propertyName: 'authors',
    resolve: 'lookup',
    lookup: { entries },
  })

  it('gives the fallback editor a row for each value', () => {
    const html = renderToStaticMarkup(
      React.createElement(FieldMapper, {
        sources: [byline],
        targets,
        mappings: [mapping([])],
        onChange: () => {},
        theme: 'none',
        defaultRows: 'all',
        slots: { lookups: 'section' },
      }),
    )
    expect(html).toContain('Mira Chen')
    expect(html).toContain('Sam Ortiz')
  })

  it('needs a lookup until every value has an entry', () => {
    const state = (entries: LookupEntry[]) =>
      rowState({ mapping: mapping(entries), requiredResolve: 'lookup', source: byline })
    expect(state([{ value: 'Mira Chen', refs: ['mira'] }])).toBe('needsLookup')
    expect(state([{ value: 'Mira Chen', refs: ['mira'] }, { value: 'Sam Ortiz', refs: ['sam'] }])).toBe('mapped')
  })

  it('previews every value', () => {
    const preview = (entries: LookupEntry[]) =>
      previewForEdge(byline, 'lookup', { mapping: mapping(entries), target: targets[0] })
    expect(preview([])).toBe('‹lookup ref for "Mira Chen"›, ‹lookup ref for "Sam Ortiz"›')
    expect(preview([{ value: 'Mira Chen', refs: ['mira'] }])).toBe('mira, ‹lookup ref for "Sam Ortiz"›')
  })
})

describe('renderLookup', () => {
  it('calls the host slot only on lookup rows and writes entries via onLookupChange', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'rss-author', propertyName: 'authors', resolve: 'lookup' },
      { sourceId: 'rss-title', propertyName: 'title' },
      { sourceId: 'rss-link', propertyName: 'html', resolve: 'extract' },
    ]
    const seen: FieldMapperLookupRow[] = []
    let nextMappings: FieldMapping[] | undefined

    const html = renderToStaticMarkup(
      React.createElement(FieldMapper, {
        sources,
        targets,
        mappings,
        onChange: (next) => {
          nextMappings = next
        },
        theme: 'none',
        defaultRows: 'all',
        slots: {
          preview: false,
          inspector: false,
          filter: false,
          autoMap: false,
          lookups: 'row',
        },
        renderLookup: (row) => {
          seen.push(row)
          return React.createElement(
            'button',
            {
              type: 'button',
              className: 'host-lookup',
              onClick: () =>
                row.onLookupChange([
                  { value: row.sampleValue, refs: ['local_1'] },
                ]),
            },
            'Select an identity…',
          )
        },
      }),
    )

    expect(html).toContain('host-lookup')
    expect(html).toContain('Select an identity…')
    expect(html).not.toContain('fm-lookup-input')
    expect(html).toContain('data-state="needsLookup"')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.id).toBe('authors')
    expect(seen[0]?.sampleValue).toBe('Mira Chen')
    expect(seen[0]?.target?.ref).toBe('Identity')
    expect(seen.some((r) => r.id === 'title' || r.id === 'html')).toBe(false)

    seen[0]?.onLookupChange([{ value: 'Mira Chen', refs: ['local_1'] }])
    expect(nextMappings).toEqual([
      {
        sourceId: 'rss-author',
        propertyName: 'authors',
        resolve: 'lookup',
        lookup: { entries: [{ value: 'Mira Chen', refs: ['local_1'] }] },
      },
      { sourceId: 'rss-title', propertyName: 'title' },
      { sourceId: 'rss-link', propertyName: 'html', resolve: 'extract' },
    ])
  })

  it('does not inject default theme paint when theme is none', () => {
    const html = renderToStaticMarkup(
      React.createElement(FieldMapper, {
        sources,
        targets,
        mappings: [
          { sourceId: 'rss-author', propertyName: 'authors', resolve: 'lookup' },
        ],
        onChange: () => {},
        theme: 'none',
        defaultRows: 'all',
        slots: {
          preview: false,
          inspector: false,
          filter: false,
          autoMap: false,
          lookups: 'row',
        },
        renderLookup: () =>
          React.createElement('span', { className: 'host-lookup' }, 'lookup'),
      }),
    )
    expect(html).toContain('seed-field-mapper--unstyled')
    expect(html).toContain('data-theme="none"')
    expect(html).not.toContain('sfm-color-well')
  })
})
