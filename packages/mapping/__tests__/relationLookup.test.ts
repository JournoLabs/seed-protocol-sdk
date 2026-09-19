import { describe, expect, it } from 'vitest'
import {
  isRelationLookupTarget,
  normalizeLookupKey,
  shapeLookupValue,
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
})
