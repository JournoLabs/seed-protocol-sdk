import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'
import { FieldMapper } from '../src/react/FieldMapper'
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
                  { value: row.sampleValue, ref: 'local_1' },
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

    seen[0]?.onLookupChange([{ value: 'Mira Chen', ref: 'local_1' }])
    expect(nextMappings).toEqual([
      {
        sourceId: 'rss-author',
        propertyName: 'authors',
        resolve: 'lookup',
        lookup: { entries: [{ value: 'Mira Chen', ref: 'local_1' }] },
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
