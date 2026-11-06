import { describe, expect, it } from 'vitest'
import { canonicalJson, CanonicalJsonError } from '../src/canonicalJson'

describe('canonicalJson', () => {
  it('sorts keys by UTF-16 code units, recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe('{"a":{"c":null,"d":true},"b":1}')
    // U+1F600 (surrogates D83D DE00) sorts before U+FB01 by code units, after it by code points
    expect(canonicalJson({ 'ﬁ': 1, '\u{1F600}': 2 })).toBe('{"\u{1F600}":2,"ﬁ":1}')
  })

  it('escapes strings as RFC 8785 does', () => {
    expect(canonicalJson('a"b\\c\n\u0001€')).toBe('"a\\"b\\\\c\\n\\u0001€"')
  })

  it('keeps array order and writes integers plainly', () => {
    expect(canonicalJson([3, 1, -0, 9007199254740991])).toBe('[3,1,0,9007199254740991]')
  })

  it('omits object properties whose value is undefined', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it.each([[1.5], [NaN], [Infinity], [2 ** 53], [[undefined]], [new Date(0)], [new Map()], [() => 1], [10n]])(
    'throws on %s',
    (v) => {
      expect(() => canonicalJson(v)).toThrow(CanonicalJsonError)
    },
  )
})
