import { describe, expect, it } from 'vitest'
import { applyMapping, applyMappingAsync, coerceValue } from '../src/applyMapping'
import type { FieldMapping, SourceNode, TargetProperty } from '../src/types'

const sources: SourceNode[] = [
  { id: 'fm-title', label: 'title', kind: 'frontmatter', value: 'Hello' },
  { id: 'section-full', label: 'Full document', kind: 'full', value: 'Body text' },
  { id: 'fm-count', label: 'count', kind: 'frontmatter', value: '42' },
  { id: 'fm-flag', label: 'flag', kind: 'frontmatter', value: 'yes' },
  { id: 'fm-when', label: 'when', kind: 'frontmatter', value: '2024-01-15T00:00:00Z' },
  { id: 'fm-meta', label: 'meta', kind: 'frontmatter', value: '{"a":1}' },
]

const targets: TargetProperty[] = [
  { name: 'title', dataType: 'String' },
  { name: 'body', dataType: 'Text' },
  { name: 'count', dataType: 'Number' },
  { name: 'flag', dataType: 'Boolean' },
  { name: 'when', dataType: 'Date' },
  { name: 'meta', dataType: 'Json' },
]

describe('coerceValue', () => {
  it('coerces Number, Boolean, Json, Date, and string', () => {
    expect(coerceValue('3.5', 'Number')).toBe(3.5)
    expect(coerceValue('yes', 'Boolean')).toBe(true)
    expect(coerceValue('{"a":1}', 'Json')).toEqual({ a: 1 })
    expect(typeof coerceValue('2024-01-15T00:00:00Z', 'Date')).toBe('number')
    expect(coerceValue('hi', 'Text')).toBe('hi')
  })

  it('falls back for invalid Json', () => {
    expect(coerceValue('not-json', 'Json')).toBe('not-json')
  })
})

describe('applyMapping', () => {
  it('builds a coerced property bag', () => {
    const mappings: FieldMapping[] = [
      { sourceId: 'fm-title', propertyName: 'title' },
      { sourceId: 'section-full', propertyName: 'body' },
      { sourceId: 'fm-count', propertyName: 'count' },
      { sourceId: 'fm-flag', propertyName: 'flag' },
      { sourceId: 'fm-when', propertyName: 'when' },
      { sourceId: 'fm-meta', propertyName: 'meta' },
    ]
    const bag = applyMapping(sources, mappings, targets)
    expect(bag.title).toBe('Hello')
    expect(bag.body).toBe('Body text')
    expect(bag.count).toBe(42)
    expect(bag.flag).toBe(true)
    expect(bag.meta).toEqual({ a: 1 })
    expect(typeof bag.when).toBe('number')
  })

  it('skips missing sources and unknown targets', () => {
    const bag = applyMapping(
      sources,
      [
        { sourceId: 'missing', propertyName: 'title' },
        { sourceId: 'fm-title', propertyName: 'nope' },
      ],
      targets,
    )
    expect(bag).toEqual({})
  })

  it('allows one source to populate multiple properties', () => {
    const linkSources: SourceNode[] = [
      {
        id: 'rss-link',
        label: 'link',
        kind: 'rssField',
        value: 'https://example.com/p/1',
      },
    ]
    const urlTargets: TargetProperty[] = [
      { name: 'importUrl', dataType: 'String' },
      { name: 'canonicalUrl', dataType: 'String' },
    ]
    const bag = applyMapping(
      linkSources,
      [
        { sourceId: 'rss-link', propertyName: 'importUrl' },
        { sourceId: 'rss-link', propertyName: 'canonicalUrl' },
      ],
      urlTargets,
    )
    expect(bag).toEqual({
      importUrl: 'https://example.com/p/1',
      canonicalUrl: 'https://example.com/p/1',
    })
  })

  it('skips mappings with resolve', () => {
    const linkSources: SourceNode[] = [
      {
        id: 'rss-link',
        label: 'link',
        kind: 'rssField',
        value: 'https://example.com/p/1',
      },
    ]
    const bag = applyMapping(
      linkSources,
      [
        { sourceId: 'rss-link', propertyName: 'importUrl' },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'extract',
        },
      ],
      [
        { name: 'importUrl', dataType: 'String' },
        { name: 'html', dataType: 'Html' },
      ],
    )
    expect(bag).toEqual({ importUrl: 'https://example.com/p/1' })
    expect(bag.html).toBeUndefined()
  })
})

describe('applyMappingAsync', () => {
  const linkSources: SourceNode[] = [
    {
      id: 'rss-link',
      label: 'link',
      kind: 'rssField',
      value: 'https://example.com/p/1',
      meta: { url: 'https://example.com/p/1', class: 'html' },
    },
    {
      id: 'rss-enclosure-0',
      label: 'enclosure[0]',
      kind: 'rssField',
      value: 'https://cdn.example/ep.mp3',
      meta: {
        url: 'https://cdn.example/ep.mp3',
        contentType: 'audio/mpeg',
        class: 'audio',
      },
    },
  ]

  it('resolves extract and file via host callback', async () => {
    const result = await applyMappingAsync(
      linkSources,
      [
        { sourceId: 'rss-link', propertyName: 'importUrl' },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'extract',
        },
        {
          sourceId: 'rss-enclosure-0',
          propertyName: 'audio',
          resolve: 'file',
        },
      ],
      [
        { name: 'importUrl', dataType: 'String' },
        { name: 'html', dataType: 'Html' },
        { name: 'audio', dataType: 'File' },
      ],
      {
        resolve: async (ctx) => {
          if (ctx.job === 'extract') return '<p>Article</p>'
          return { seedUid: '0xabc', kind: 'file' }
        },
      },
    )
    expect(result.errors).toEqual([])
    expect(result.properties.importUrl).toBe('https://example.com/p/1')
    expect(result.properties.html).toBe('<p>Article</p>')
    expect(result.properties.audio).toEqual({ seedUid: '0xabc', kind: 'file' })
  })

  it('collects errors and keeps partial bag', async () => {
    const result = await applyMappingAsync(
      linkSources,
      [
        { sourceId: 'rss-link', propertyName: 'importUrl' },
        {
          sourceId: 'rss-link',
          propertyName: 'html',
          resolve: 'extract',
        },
      ],
      [
        { name: 'importUrl', dataType: 'String' },
        { name: 'html', dataType: 'Html' },
      ],
      {
        resolve: async () => {
          throw new Error('fetch failed')
        },
      },
    )
    expect(result.properties).toEqual({
      importUrl: 'https://example.com/p/1',
    })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toBe('fetch failed')
    expect(result.errors[0]?.resolve).toBe('extract')
  })
})
