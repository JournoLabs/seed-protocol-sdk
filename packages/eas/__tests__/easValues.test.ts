import { describe, expect, it } from 'vitest'
import { decodeEasNumber, isEasEmptyValue, isNumericEasType } from '../src/easValues.js'

describe('decodeEasNumber', () => {
  it.each([
    // What the OP Sepolia indexer returns for uint8 and uint256 fields.
    [1, '1'],
    ['4', '4'],
    [{ type: 'BigNumber', hex: '0x034f4d' }, '216909'],
    [{ type: 'BigNumber', hex: '-0x01' }, '-1'],
    [{ _hex: '0x0100' }, '256'],
    // What Seed publishes as a string.
    ['256', '256'],
    ['-1', '-1'],
    ['1.5', '1.5'],
    ['1e+21', '1e+21'],
    ['9007199254740993', '9007199254740993'],
    ['007', '7'],
    [' 42 ', '42'],
    ['0x10', '16'],
    [0, '0'],
    ['0', '0'],
    [-2.25, '-2.25'],
  ])('%j → %s', (input, expected) => {
    expect(decodeEasNumber(input)).toBe(expected)
  })

  it('a bigint', () => {
    expect(decodeEasNumber(2n ** 255n)).toBe((2n ** 255n).toString())
  })

  it.each([['abc'], [''], ['  '], [NaN], [Infinity], [null], [undefined], [{}], [{ hex: 'zz' }], [true], [[1]]])(
    '%j is not numeric',
    (input) => {
      expect(decodeEasNumber(input)).toBeUndefined()
    },
  )
})

describe('isNumericEasType', () => {
  it.each([['uint8'], ['uint256'], ['int256'], ['uint'], ['int64']])('%s is numeric', (t) => {
    expect(isNumericEasType(t)).toBe(true)
  })
  it.each([['string'], ['bytes32'], ['bool'], ['uint256[]'], [undefined]])('%s is not', (t) => {
    expect(isNumericEasType(t as string)).toBe(false)
  })
})

describe('isEasEmptyValue (ADR 0021)', () => {
  it.each([
    ['string', ''],
    ['bytes32', '0x' + '0'.repeat(64)],
  ])('%s %j is a removal', (type, value) => {
    expect(isEasEmptyValue(type, value)).toBe(true)
  })

  it.each([
    ['string', ' '],
    ['string', null],
    ['bytes32', '0x' + '0'.repeat(62) + '20'],
    ['bytes32[]', []],
    ['bool', false],
    ['uint256', 0],
  ])('%s %j is a value', (type, value) => {
    expect(isEasEmptyValue(type, value)).toBe(false)
  })
})
