// PermaPress 0244/0245: one feed string can name several people ("Mira Chen and Sam Ortiz"). An
// entry maps a string to an ordered list of refs, and a lookup edge can split a string with no
// entry of its own and look up each part.
import { describe, expect, it } from 'vitest'
import { applyMapping, applyMappingAsync } from '../src/applyMapping'
import { autoMap } from '../src/autoMap'
import { withPreservedExtras } from '../src/edgeMapping'
import {
  DEFAULT_LOOKUP_SEPARATORS,
  lookupEntriesFromMapping,
  splitLookupValue,
  stripLookup,
} from '../src/relationLookup'
import { applyLookupSplitToMappings } from '../src/react/fieldMapperCore'
import type { FieldMapping, LookupEntry, SourceNode, TargetProperty, UnmatchedLookup } from '../src/types'

const authors: TargetProperty = { name: 'authors', dataType: 'List', refValueType: 'Relation', ref: 'Identity' }
const author: TargetProperty = { name: 'author', dataType: 'Relation', ref: 'Identity' }
const byline = (value: string): SourceNode => ({ id: 'rss-author', label: 'author', kind: 'rssField', value })
const edge = (entries: LookupEntry[], extra: Partial<FieldMapping> = {}): FieldMapping => ({
  sourceId: 'rss-author',
  propertyName: 'authors',
  resolve: 'lookup',
  lookup: { entries },
  ...extra,
})
const people: LookupEntry[] = [
  { value: 'Mira Chen', refs: ['mira'] },
  { value: 'Sam Ortiz', refs: ['sam'] },
]
const splitOn = { split: { separators: [...DEFAULT_LOOKUP_SEPARATORS] } }

function apply(value: string, mapping: FieldMapping, target = authors) {
  const misses: UnmatchedLookup[] = []
  const bag = applyMapping([byline(value)], [mapping], [target], { onUnmatched: (m) => misses.push(m) })
  return { bag, misses }
}

describe('an entry names a list of refs', () => {
  it('applies every ref in the entry, in order', () => {
    const { bag } = apply('Mira Chen and Sam Ortiz', edge([{ value: 'Mira Chen and Sam Ortiz', refs: ['mira', 'sam'] }]))
    expect(bag).toEqual({ authors: ['mira', 'sam'] })
  })

  it('reads a stored { value, ref } as one ref', () => {
    const stored = edge([{ value: 'Mira Chen', ref: 'mira' } as unknown as LookupEntry])
    expect(apply('Mira Chen', stored).bag).toEqual({ authors: ['mira'] })
    expect(lookupEntriesFromMapping(stored)).toEqual([{ value: 'Mira Chen', refs: ['mira'] }])
  })

  it('a single Relation target takes the first ref', () => {
    const mapping = edge([{ value: 'Mira Chen and Sam Ortiz', refs: ['mira', 'sam'] }], { propertyName: 'author' })
    expect(apply('Mira Chen and Sam Ortiz', mapping, author).bag).toEqual({ author: 'mira' })
  })
})

describe('split, then lookup', () => {
  it('without split, a joint string with no entry is one miss', () => {
    const { bag, misses } = apply('Mira Chen and Sam Ortiz', edge(people))
    expect(bag).toEqual({})
    expect(misses.map((m) => m.value)).toEqual(['Mira Chen and Sam Ortiz'])
  })

  it('looks up each part in the string order', () => {
    expect(apply('Sam Ortiz & Mira Chen', edge(people, splitOn)).bag).toEqual({ authors: ['sam', 'mira'] })
    expect(apply('mira chen AND sam ortiz', edge(people, splitOn)).bag).toEqual({ authors: ['mira', 'sam'] })
  })

  it("the whole string's own entry wins over its parts", () => {
    const desk = { value: 'Mira Chen and Sam Ortiz', refs: ['desk'] }
    expect(apply('Mira Chen and Sam Ortiz', edge([...people, desk], splitOn)).bag).toEqual({ authors: ['desk'] })
  })

  it('keeps the known parts and reports each unknown part with the string it came from', () => {
    const { bag, misses } = apply('Mira Chen and Lee Park', edge(people, splitOn))
    expect(bag).toEqual({ authors: ['mira'] })
    expect(misses).toEqual([
      { sourceId: 'rss-author', propertyName: 'authors', value: 'Lee Park', splitFrom: 'Mira Chen and Lee Park' },
    ])
  })

  it('a string with no separator is reported whole', () => {
    const { misses } = apply('Lee Park', edge(people, splitOn))
    expect(misses).toEqual([{ sourceId: 'rss-author', propertyName: 'authors', value: 'Lee Park' }])
  })

  it('async apply names the part that missed', async () => {
    const { properties, errors } = await applyMappingAsync(
      [byline('Mira Chen & Lee Park')],
      [edge(people, splitOn)],
      [authors],
    )
    expect(properties).toEqual({ authors: ['mira'] })
    expect(errors.map((e) => e.message)).toEqual(['No lookup entry for "Lee Park" (split from "Mira Chen & Lee Park")'])
  })
})

describe('separators', () => {
  it('comma is off by default, so "Chen, Mira" stays one name', () => {
    expect(splitLookupValue('Chen, Mira', DEFAULT_LOOKUP_SEPARATORS)).toEqual(['Chen, Mira'])
    expect(splitLookupValue('A, B and C', ['and', ','])).toEqual(['A', 'B', 'C'])
  })

  it('"and" splits only as a word with spaces around it', () => {
    expect(splitLookupValue('Anderson Brand', ['and'])).toEqual(['Anderson Brand'])
    expect(splitLookupValue('Ann Band and Lee', ['and'])).toEqual(['Ann Band', 'Lee'])
  })
})

describe('keeping split', () => {
  it('moving a lookup to another source keeps split', () => {
    const next = withPreservedExtras({ sourceId: 'dc-creator', propertyName: 'authors', resolve: 'lookup' }, edge(people, splitOn))
    expect(next.split).toEqual(splitOn.split)
    expect(next.lookup?.entries).toEqual(people)
  })

  it('autoMap keeps split on a property that stays a lookup', () => {
    const mapped = autoMap([byline('Mira Chen')], [authors], [edge([], splitOn)])
    expect(mapped.find((m) => m.propertyName === 'authors')?.split).toEqual(splitOn.split)
  })

  it('a lookup that becomes another job drops split', () => {
    expect(stripLookup(edge(people, splitOn))).toEqual({ sourceId: 'rss-author', propertyName: 'authors', resolve: 'lookup' })
  })

  it('the field mapper sets and clears split on a lookup row', () => {
    const set = applyLookupSplitToMappings([edge(people)], 'property', 'authors', [], ['and', '&'])
    expect(set?.[0]?.split).toEqual({ separators: ['and', '&'] })
    const cleared = applyLookupSplitToMappings(set!, 'property', 'authors', [], null)
    expect(cleared?.[0]?.split).toBeUndefined()
  })
})
