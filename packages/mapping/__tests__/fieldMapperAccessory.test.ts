import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'
import { FieldMapper } from '../src/react/FieldMapper'
import {
  formatSourceOptionLabel,
} from '../src/react/fieldMapperCore'
import type { FieldMapperRow } from '../src/react/fieldMapperTypes'

const sources: SourceNode[] = [
  {
    id: 'rss-link',
    label: 'link',
    kind: 'rssField',
    value: 'https://example.org/post',
    meta: { url: 'https://example.org/post', class: 'html' },
  },
  {
    id: 'rss-title',
    label: 'title',
    kind: 'rssField',
    value: 'Hello',
  },
]

const targets: TargetProperty[] = [
  { name: 'html', dataType: 'Html', required: true },
  { name: 'title', dataType: 'String', required: true },
]

describe('formatSourceOptionLabel subtitle', () => {
  it('includes subtitle before the sample quote', () => {
    const node: SourceNode = {
      id: 'rss-link@extract',
      label: 'page',
      subtitle: 'link',
      kind: 'resolved',
      value: 'https://example.org/very-long-path/that-gets-truncated',
    }
    expect(formatSourceOptionLabel(node)).toBe(
      'page · link · "https://example.org/very-long-path/t…"',
    )
  })

  it('keeps label-only formatting when subtitle is absent', () => {
    expect(formatSourceOptionLabel(sources[1]!)).toBe('title · "Hello"')
  })
})

describe('renderRowAccessory', () => {
  it('mounts host chrome in fm-row-accessory for extract edges', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'rss-link', propertyName: 'html', resolve: 'extract' },
      { sourceId: 'rss-title', propertyName: 'title' },
    ]
    const seen: FieldMapperRow[] = []

    const html = renderToStaticMarkup(
      React.createElement(FieldMapper, {
        sources,
        targets,
        mappings,
        onChange: () => {},
        theme: 'none',
        defaultRows: 'all',
        slots: { preview: false, inspector: false, filter: false, autoMap: false },
        renderRowAccessory: (row) => {
          seen.push(row)
          if (row.mapping?.resolve !== 'extract' && row.mapping?.resolve !== 'file') {
            return null
          }
          return React.createElement(
            'button',
            { type: 'button', className: 'host-preview' },
            'Preview',
          )
        },
      }),
    )

    expect(html).toContain('fm-row-accessory')
    expect(html).toContain('host-preview')
    expect(html).toContain('Preview')
    expect(seen.some((r) => r.id === 'html' && r.mapping?.resolve === 'extract')).toBe(
      true,
    )
    const htmlRow = seen.find((r) => r.id === 'html')
    expect(htmlRow?.source?.id).toBe('rss-link')
  })
})
