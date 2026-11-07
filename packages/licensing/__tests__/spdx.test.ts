import { describe, expect, it } from 'vitest'
import { parseSpdx, isKnownSpdxId, SPDX_LIST_VERSION } from '../src'

const ok = (expression: string) => {
  const result = parseSpdx(expression)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('parseSpdx', () => {
  it('pins the list version', () => expect(SPDX_LIST_VERSION).toBe('3.29.0'))

  it('reports listed case', () => {
    expect(isKnownSpdxId('cc-by-nc-4.0')).toBe('CC-BY-NC-4.0')
    expect(isKnownSpdxId('Classpath-exception-2.0')).toBeUndefined()
    expect(ok('mit').ids).toEqual(['MIT'])
  })

  it('binds WITH tighter than AND tighter than OR', () => {
    expect(ok('MIT OR Apache-2.0 AND GPL-2.0-only WITH Classpath-exception-2.0').ast).toEqual({
      type: 'or',
      left: { type: 'license', id: 'MIT', plus: false },
      right: {
        type: 'and',
        left: { type: 'license', id: 'Apache-2.0', plus: false },
        right: { type: 'license', id: 'GPL-2.0-only', plus: false, exception: 'Classpath-exception-2.0' },
      },
    })
  })

  it('handles parentheses, +, LicenseRef and DocumentRef', () => {
    expect(ok('(CC-BY-NC-4.0 OR LicenseRef-seed-commercial-1)').ids).toEqual([
      'CC-BY-NC-4.0',
      'LicenseRef-seed-commercial-1',
    ])
    expect(ok('Apache-1.0+').ast).toEqual({ type: 'license', id: 'Apache-1.0', plus: true })
    expect(ok('DocumentRef-spdx-tool-1.2:LicenseRef-MIT-Style-2').ast).toEqual({
      type: 'ref',
      id: 'LicenseRef-MIT-Style-2',
      documentRef: 'DocumentRef-spdx-tool-1.2',
    })
  })

  it('dedupes ids in order of appearance', () => expect(ok('MIT AND (MIT OR CC0-1.0)').ids).toEqual(['MIT', 'CC0-1.0']))

  it('returns an error for very deep nesting instead of overflowing the stack', () => {
    const deep = '('.repeat(20000) + 'MIT' + ')'.repeat(20000)
    const result = parseSpdx(deep)
    expect(!result.ok && result.error).toMatch(/nested too deeply/)
    expect(parseSpdx('('.repeat(64) + 'MIT' + ')'.repeat(64)).ok).toBe(true)
  })

  it('flags deprecated ids', () => expect(ok('GPL-2.0').deprecated).toEqual(['GPL-2.0']))

  it('says why a lowercase operator fails', () => {
    const result = parseSpdx('MIT or Apache-2.0')
    expect(!result.ok && result.error).toMatch(/operators must be uppercase/)
  })

  it.each(['', 'NOT-A-LICENSE', 'MIT OR', 'MIT or Apache-2.0', '(MIT', 'MIT)', 'MIT WITH NotAnException', 'LicenseRef-', 'MIT MIT'])(
    'rejects %j',
    (expression) => expect(parseSpdx(expression).ok).toBe(false),
  )
})
