import { describe, expect, it } from 'vitest'
import { applyMapping, coerceValue } from '../src/applyMapping'
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
})
