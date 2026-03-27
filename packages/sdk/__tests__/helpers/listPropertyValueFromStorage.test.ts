import { describe, it, expect } from 'vitest'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'

describe('parseListPropertyValueFromStorage', () => {
  it('parses JSON array strings', () => {
    expect(parseListPropertyValueFromStorage('["a","b"]')).toEqual(['a', 'b'])
    expect(parseListPropertyValueFromStorage('["k1WzrVzCrD"]')).toEqual(['k1WzrVzCrD'])
  })

  it('stringifies JSON non-string elements', () => {
    expect(parseListPropertyValueFromStorage('[1,2]')).toEqual(['1', '2'])
  })

  it('splits legacy comma-separated ids when not JSON array', () => {
    expect(parseListPropertyValueFromStorage('id1,id2')).toEqual(['id1', 'id2'])
    expect(parseListPropertyValueFromStorage('a, b , c')).toEqual(['a', 'b', 'c'])
  })

  it('returns single-element array for plain token without comma', () => {
    expect(parseListPropertyValueFromStorage('k1WzrVzCrD')).toEqual(['k1WzrVzCrD'])
    expect(parseListPropertyValueFromStorage('0x' + 'a'.repeat(64))).toEqual([
      '0x' + 'a'.repeat(64),
    ])
  })

  it('returns empty array for empty or whitespace', () => {
    expect(parseListPropertyValueFromStorage('')).toEqual([])
    expect(parseListPropertyValueFromStorage('  \t  ')).toEqual([])
  })

  it('falls back to comma split when JSON array is invalid', () => {
    expect(parseListPropertyValueFromStorage('[not-json')).toEqual(['[not-json'])
  })
})
