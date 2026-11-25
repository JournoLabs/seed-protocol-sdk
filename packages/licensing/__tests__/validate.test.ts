import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../terms.schema.json'
import { ACTIONS, RULE_IDS, USER_CLASSES, canonicalSpdx, termsHash, validateTerms } from '../src'
import { invalidTerms, validTerms } from './fixtures/terms'

describe('validateTerms', () => {
  it.each(Object.entries(validTerms))('accepts %s', (_, terms) => expect(validateTerms(terms).ok).toBe(true))

  it.each(Object.entries(invalidTerms))('rejects %s without throwing', (_, terms) => {
    const result = validateTerms(terms)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })

  it('names the path of the defect', () => {
    const result = validateTerms(invalidTerms.unknownAction)
    expect(!result.ok && result.errors[0]!.path).toBe('permissions[0].action')
  })

  it('rejects a non-canonical SPDX expression and names the canonical spelling', () => {
    for (const [spdx, canonical] of [
      ['cc-by-4.0', 'CC-BY-4.0'],
      ['MIT  OR Apache-2.0', 'MIT OR Apache-2.0'],
      ['(MIT)', 'MIT'],
      ['mit or apache-2.0', undefined],
    ] as const) {
      const result = validateTerms({ ...validTerms.ccBy, spdx })
      expect(result.ok, spdx).toBe(false)
      if (!result.ok && canonical) {
        expect(result.errors[0]!.path).toBe('spdx')
        expect(result.errors[0]!.message).toContain(`"${canonical}"`)
      }
    }
  })

  it('rejects a non-canonical share-alike license', () => {
    const result = validateTerms({ ...validTerms.ccBy, duties: [{ duty: 'shareAlike', license: 'cc-by-sa-4.0' }] })
    expect(!result.ok && result.errors[0]).toMatchObject({ path: 'duties[0].license' })
    expect(!result.ok && result.errors[0]!.message).toContain('"CC-BY-SA-4.0"')
  })

  it('accepts canonical compound expressions', () => {
    for (const spdx of ['MIT OR Apache-2.0', '(MIT OR Apache-2.0) AND BSD-3-Clause', 'GPL-2.0-only WITH Classpath-exception-2.0', 'Apache-2.0+']) {
      expect(validateTerms({ ...validTerms.ccBy, spdx }).ok, spdx).toBe(true)
    }
  })

  it('termsHash refuses a non-canonical spelling instead of normalizing it', () => {
    expect(() => termsHash({ ...validTerms.ccBy, spdx: 'cc-by-4.0' })).toThrow(/canonically/)
  })

  it('exports the vocabularies', () => {
    expect(ACTIONS).toContain('seed:aiTrain')
    expect(USER_CLASSES).toContain('education')
    expect(RULE_IDS).toContain('share-alike')
  })

  it('returns the terms it accepted', () => {
    const result = validateTerms(validTerms.ccBy)
    expect(result.ok && result.terms).toBe(validTerms.ccBy)
  })
})

describe('terms.schema.json', () => {
  const check = new Ajv2020({ strict: true }).compile(schema)
  // Rules JSON Schema can't express; the schema's description lists them.
  const SCHEMA_BLIND = ['permittedAndProhibited', 'shareAlikeWithoutDerive', 'badSpdx', 'badChangeLicense', 'lowerCaseSpdx', 'doubleSpaceSpdx', 'redundantParensSpdx']
  const cases = [
    ...Object.entries(validTerms),
    ...Object.entries(invalidTerms).filter(([name]) => !SCHEMA_BLIND.includes(name)),
  ]
  it.each(cases)('agrees with validateTerms on %s', (_, terms) => {
    // JSON.stringify drops undefined keys, as termsHash does.
    expect(check(JSON.parse(JSON.stringify(terms ?? null)))).toBe(validateTerms(terms).ok)
  })
})
