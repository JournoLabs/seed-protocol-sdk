import { describe, expect, it } from 'vitest'
import {
  isRelationLookupTarget,
  lookupRefsFromEntries,
  normalizeLookupKey,
  resolveLookup,
  sampleValueFromSource,
  shapeLookupValue,
  withLookupEntries,
} from '../src/relationLookup'
import type { TargetProperty } from '../src/types'

describe('relationLookup', () => {
  it('detects Relation and List-of-Relation targets', () => {
    expect(
      isRelationLookupTarget({ name: 'publication', dataType: 'Relation' }),
    ).toBe(true)
    expect(
      isRelationLookupTarget({
        name: 'authors',
        dataType: 'List',
        refValueType: 'Relation',
        ref: 'Identity',
      }),
    ).toBe(true)
    expect(
      isRelationLookupTarget({
        name: 'authors',
        dataType: 'List',
        ref: 'Identity',
      }),
    ).toBe(true)
    expect(
      isRelationLookupTarget({
        name: 'tags',
        dataType: 'List',
        refValueType: 'Text',
      }),
    ).toBe(false)
    expect(
      isRelationLookupTarget({ name: 'title', dataType: 'String' }),
    ).toBe(false)
  })

  it('normalizes lookup keys', () => {
    expect(normalizeLookupKey('  Jane   Doe  ')).toBe('Jane Doe')
  })

  it('shapes list vs relation values', () => {
    const list: TargetProperty = {
      name: 'authors',
      dataType: 'List',
      ref: 'Identity',
    }
    const rel: TargetProperty = { name: 'publication', dataType: 'Relation' }
    expect(shapeLookupValue('uid-1', list)).toEqual(['uid-1'])
    expect(shapeLookupValue(['a', 'b'], list)).toEqual(['a', 'b'])
    expect(shapeLookupValue('uid-1', rel)).toBe('uid-1')
    expect(shapeLookupValue(['a', 'b'], rel)).toBe('a')
  })

  it('matches lookup entries by normalized value', () => {
    const entries = [{ value: '  Mira   Chen  ', refs: ['local_1'] }]
    expect(lookupRefsFromEntries(entries, 'Mira Chen')).toEqual(['local_1'])
    expect(lookupRefsFromEntries(entries, 'Sam Ortiz')).toBeUndefined()
    expect(lookupRefsFromEntries([], 'Mira Chen')).toBeUndefined()
    expect(lookupRefsFromEntries([{ value: 'Mira Chen', refs: ['  '] }], 'Mira Chen')).toBeUndefined()
  })

  it('prefers edge entries over deprecated document lookups', () => {
    const mapping = {
      sourceId: 'author',
      propertyName: 'authors',
      resolve: 'lookup' as const,
      lookup: { entries: [{ value: 'Mira Chen', refs: ['edge_ref'] }] },
    }
    expect(
      resolveLookup(mapping, 'Mira Chen', {
        authors: { 'Mira Chen': 'doc_ref' },
      }).refs,
    ).toEqual(['edge_ref'])
    expect(
      resolveLookup(
        { sourceId: 'author', propertyName: 'authors', resolve: 'lookup' },
        'Mira Chen',
        { authors: { 'Mira Chen': 'doc_ref' } },
      ).refs,
    ).toEqual(['doc_ref'])
  })

  it('omits lookup when entries are cleared', () => {
    const edge = withLookupEntries(
      {
        sourceId: 'author',
        propertyName: 'authors',
        resolve: 'lookup',
        lookup: { entries: [{ value: 'Mira Chen', refs: ['local_1'] }] },
      },
      [],
    )
    expect(edge.lookup).toBeUndefined()
  })

  it('reads a normalized sample from the source value', () => {
    expect(
      sampleValueFromSource({
        id: 'author',
        label: 'author',
        kind: 'rssField',
        value: '  Mira   Chen  ',
      }),
    ).toBe('Mira Chen')
  })

  it("reads an empty value as '', not the source's label", () => {
    expect(sampleValueFromSource({ id: 'author', label: 'author', kind: 'rssField', value: '' })).toBe('')
  })
})
