import { describe, expect, it } from 'vitest'
import {
  isRelationLookupTarget,
  lookupRefFromEntries,
  normalizeLookupKey,
  resolveLookupMapped,
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
    const entries = [{ value: '  Mira   Chen  ', ref: 'local_1' }]
    expect(lookupRefFromEntries(entries, 'Mira Chen')).toBe('local_1')
    expect(lookupRefFromEntries(entries, 'Sam Ortiz')).toBeUndefined()
    expect(lookupRefFromEntries([], 'Mira Chen')).toBeUndefined()
    expect(lookupRefFromEntries([{ value: 'Mira Chen', ref: '  ' }], 'Mira Chen')).toBeUndefined()
  })

  it('prefers edge entries over deprecated document lookups', () => {
    const mapping = {
      sourceId: 'author',
      propertyName: 'authors',
      resolve: 'lookup' as const,
      lookup: { entries: [{ value: 'Mira Chen', ref: 'edge_ref' }] },
    }
    expect(
      resolveLookupMapped(mapping, 'Mira Chen', {
        authors: { 'Mira Chen': 'doc_ref' },
      }),
    ).toBe('edge_ref')
    expect(
      resolveLookupMapped(
        { sourceId: 'author', propertyName: 'authors', resolve: 'lookup' },
        'Mira Chen',
        { authors: { 'Mira Chen': 'doc_ref' } },
      ),
    ).toBe('doc_ref')
  })

  it('omits lookup when entries are cleared', () => {
    const edge = withLookupEntries(
      {
        sourceId: 'author',
        propertyName: 'authors',
        resolve: 'lookup',
        lookup: { entries: [{ value: 'Mira Chen', ref: 'local_1' }] },
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
})
