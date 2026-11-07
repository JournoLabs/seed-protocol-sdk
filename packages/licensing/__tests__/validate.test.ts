import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import schema from '../terms.schema.json'
import { validateTerms } from '../src'
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

  it('returns the terms it accepted', () => {
    const result = validateTerms(validTerms.ccBy)
    expect(result.ok && result.terms).toBe(validTerms.ccBy)
  })
})

describe('terms.schema.json', () => {
  const check = new Ajv2020({ strict: true }).compile(schema)
  // Rules JSON Schema can't express; the schema's description lists them.
  const SCHEMA_BLIND = ['permittedAndProhibited', 'shareAlikeWithoutDerive', 'badSpdx', 'badChangeLicense']
  const cases = [
    ...Object.entries(validTerms),
    ...Object.entries(invalidTerms).filter(([name]) => !SCHEMA_BLIND.includes(name)),
  ]
  it.each(cases)('agrees with validateTerms on %s', (_, terms) => {
    // JSON.stringify drops undefined keys, as termsHash does.
    expect(check(JSON.parse(JSON.stringify(terms ?? null)))).toBe(validateTerms(terms).ok)
  })
})
