// PermaPress seed-mapping-asks (0183–0185): one feed prints the same author in different cases, a
// sync apply has to say a name had no entry, and Auto-map or a source change must not drop twenty
// author assignments.
import { describe, expect, it } from 'vitest'
import { applyMapping, applyMappingAsync } from '../src/applyMapping'
import { autoMap } from '../src/autoMap'
import { withPreservedExtras } from '../src/edgeMapping'
import { collectLookupValues, lookupKey, lookupRefFromEntries, normalizeLookupKey } from '../src/relationLookup'
import type { FieldMapping, SourceNode, TargetProperty, UnmatchedLookup } from '../src/types'

const authors: TargetProperty = { name: 'authors', dataType: 'List', refValueType: 'Relation', ref: 'Identity' }
const author = (value: string, id = 'rss-author'): SourceNode => ({ id, label: 'author', kind: 'rssField', value })
const lookupEdge = (entries: Array<{ value: string; ref: string }>): FieldMapping => ({
  sourceId: 'rss-author',
  propertyName: 'authors',
  resolve: 'lookup',
  lookup: { entries },
})

describe('lookupKey', () => {
  it('matches across case, Unicode composition and whitespace', () => {
    expect(lookupKey('  mira   CHEN ')).toBe(lookupKey('Mira Chen'))
    expect(lookupKey('Zoé')).toBe(lookupKey('Zoé'))
    expect(lookupKey('Straße')).toBe(lookupKey('STRASSE'))
  })

  it('keeps case in the stored form', () => {
    expect(normalizeLookupKey('  Mira   Chen ')).toBe('Mira Chen')
  })

  it('finds an entry whatever case the feed printed', () => {
    const entries = [{ value: 'Mira Chen', ref: 'local_1' }]
    expect(lookupRefFromEntries(entries, 'mira chen')).toBe('local_1')
    expect(applyMapping([author('MIRA CHEN')], [lookupEdge(entries)], [authors])).toEqual({ authors: ['local_1'] })
  })
})

describe('unmatched lookups', () => {
  it('sync apply reports a value with no entry', () => {
    const misses: UnmatchedLookup[] = []
    const bag = applyMapping([author('Sam Ortiz')], [lookupEdge([{ value: 'Mira Chen', ref: 'local_1' }])], [authors], {
      onUnmatched: (miss) => misses.push(miss),
    })
    expect(bag).toEqual({})
    expect(misses).toEqual([{ sourceId: 'rss-author', propertyName: 'authors', value: 'Sam Ortiz' }])
  })

  it('an empty value is no lookup, in sync and async apply', async () => {
    const misses: UnmatchedLookup[] = []
    const edges = [lookupEdge([{ value: 'Mira Chen', ref: 'local_1' }])]
    expect(applyMapping([author('  ')], edges, [authors], { onUnmatched: (miss) => misses.push(miss) })).toEqual({})
    expect(misses).toEqual([])
    expect((await applyMappingAsync([author('')], edges, [authors])).errors).toEqual([])
  })
})

describe('keeping entries', () => {
  const entries = [{ value: 'Mira Chen', ref: 'local_1' }]

  it('autoMap keeps the entries of a property that stays a lookup', () => {
    const mappings = autoMap([author('Mira Chen')], [authors], [lookupEdge(entries)])
    expect(mappings.find((m) => m.propertyName === 'authors')?.lookup).toEqual({ entries })
  })

  it('moving a lookup to another source keeps its entries', () => {
    const next = withPreservedExtras(
      { sourceId: 'dc-creator', propertyName: 'authors', resolve: 'lookup' },
      lookupEdge(entries),
    )
    expect(next).toEqual({ sourceId: 'dc-creator', propertyName: 'authors', resolve: 'lookup', lookup: { entries } })
  })
})

describe('collectLookupValues', () => {
  it('lists each value across items once, as first printed, without empties', () => {
    const items = [[author('Mira Chen')], [author('mira  chen')], [author('')], [author('Sam Ortiz')], [author('x', 'other')]]
    expect(collectLookupValues(items, lookupEdge([]))).toEqual(['Mira Chen', 'Sam Ortiz'])
  })
})
