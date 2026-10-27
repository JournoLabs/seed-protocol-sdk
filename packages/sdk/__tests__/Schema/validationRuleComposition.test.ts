import { describe, it, expect } from 'vitest'
import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { ModelPropertyDataTypes } from '@/helpers/property'

/** Rules combine: each one used to replace the schema built so far. */
describe('validatePropertyValue combines rules', () => {
  const service = new SchemaValidationService()
  const check = (value: unknown, dataType: ModelPropertyDataTypes, rules: Record<string, unknown>) =>
    service.validatePropertyValue(value, dataType, rules as any).isValid

  it('enforces pattern on Text alongside the default maxLength', () => {
    expect(check('abc', ModelPropertyDataTypes.Text, { pattern: '^[a-z]+$' })).toBe(true)
    expect(check('ABC', ModelPropertyDataTypes.Text, { pattern: '^[a-z]+$' })).toBe(false)
    expect(check('a'.repeat(300), ModelPropertyDataTypes.Text, { pattern: '^[a-z]+$' })).toBe(false)
  })

  it('keeps pattern on Html when a length rule is set', () => {
    expect(check('<p>x</p>', ModelPropertyDataTypes.Html, { pattern: '^<p>', maxLength: 50 })).toBe(true)
    expect(check('<div>x</div>', ModelPropertyDataTypes.Html, { pattern: '^<p>', maxLength: 50 })).toBe(false)
  })

  it('applies enum together with length rules', () => {
    const rules = { enum: ['draft', 'published', 'archived-for-a-long-time'], maxLength: 10 }
    expect(check('draft', ModelPropertyDataTypes.Text, rules)).toBe(true)
    expect(check('other', ModelPropertyDataTypes.Text, rules)).toBe(false)
    expect(check('archived-for-a-long-time', ModelPropertyDataTypes.Text, rules)).toBe(false)
  })

  it('accepts ISO date strings for Date (the date-time format is registered)', () => {
    expect(check('2025-01-15T00:00:00.000Z', ModelPropertyDataTypes.Date, {})).toBe(true)
    expect(check('not a date', ModelPropertyDataTypes.Date, {})).toBe(false)
  })

  it('applies enum on its own to non-string types', () => {
    expect(check(2, ModelPropertyDataTypes.Number, { enum: [1, 2] })).toBe(true)
    expect(check(3, ModelPropertyDataTypes.Number, { enum: [1, 2] })).toBe(false)
  })
})
