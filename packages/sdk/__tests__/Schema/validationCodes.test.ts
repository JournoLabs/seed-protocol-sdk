import { describe, it, expect } from 'vitest'
import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'

const service = new SchemaValidationService()
const codes = (value: unknown, dataType: ModelPropertyDataTypes, rules?: Record<string, unknown>, refValueType?: string) =>
  service.validatePropertyValue(value, dataType, rules as any, refValueType).errors.map((e) => e.code)

/** Value errors carry named codes; they carried TypeBox's numeric kinds ('41', '53', '62'). */
describe('validatePropertyValue error codes', () => {
  it('names a wrong type', () => {
    expect(codes('many', ModelPropertyDataTypes.Number)).toEqual(['type'])
    expect(codes({ id: 'x' }, ModelPropertyDataTypes.Relation)).toEqual(['type'])
  })

  it('names a pattern miss', () => {
    expect(codes('ABC', ModelPropertyDataTypes.Text, { pattern: '^[a-z]+$' })).toEqual(['pattern'])
  })

  it('names a minLength miss apart from maxLength', () => {
    expect(codes('ab', ModelPropertyDataTypes.Text, { minLength: 3 })).toEqual(['min_length'])
    expect(codes('abcdef', ModelPropertyDataTypes.Text, { maxLength: 3 })).toEqual(['max_length_exceeded'])
  })

  it('names a Date that is not a date', () => {
    expect(codes('not a date', ModelPropertyDataTypes.Date)).toEqual(['format'])
  })

  it('keeps each List element its own code', () => {
    expect(codes(['ok', 'ABC'], ModelPropertyDataTypes.List, { pattern: '^[a-z]+$' }, 'Text')).toEqual(['pattern'])
  })
})

/** An enum miss is one problem with its own code, beside any other rule the value breaks. */
describe('validatePropertyValue enum', () => {
  it('reports one enum_violation that lists the allowed values', () => {
    const result = service.validatePropertyValue('other', ModelPropertyDataTypes.Text, { enum: ['draft', 'published'] })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('enum_violation')
    expect(result.errors[0].message).toBe('Expected one of: "draft", "published". Received: "other"')
  })

  it('reports enum and length separately when both are broken', () => {
    const rules = { enum: ['draft', 'archived-for-a-long-time'], maxLength: 10 }
    expect(codes('archived-for-a-long-time', ModelPropertyDataTypes.Text, rules)).toEqual(['max_length_exceeded'])
    expect(codes('other-value-too-long', ModelPropertyDataTypes.Text, rules).sort()).toEqual(['enum_violation', 'max_length_exceeded'])
  })

  it('reports one problem per List element that misses the enum', () => {
    expect(codes(['a', 'x', 'y'], ModelPropertyDataTypes.List, { enum: ['a', 'b'] }, 'Text')).toEqual(['enum_violation', 'enum_violation'])
  })
})

describe('the default Text limit message', () => {
  it('points to validation.maxLength and Html', () => {
    const [error] = service.validatePropertyValue('a'.repeat(256), ModelPropertyDataTypes.Text).errors
    expect(error.code).toBe('max_length_exceeded')
    expect(error.message).toContain('validation.maxLength')
    expect(error.message).toContain('Html')
    expect(error.message).not.toContain('File')
  })
})

describe('validatePropertyStructure', () => {
  const structure = (property: Record<string, unknown>) =>
    service.validatePropertyStructure({ name: 'p', ...property } as any)

  it('warns about custom validators and ignores them (decision D5)', () => {
    const result = structure({ dataType: 'Text', validation: { custom: 'isSlug' } })
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings?.map((w) => w.code)).toEqual(['custom_validation_unsupported'])
  })

  it('rejects length and pattern rules on a type they do not apply to (decision D19)', () => {
    for (const validation of [{ maxLength: 20 }, { minLength: 1 }, { pattern: '^a' }]) {
      const result = structure({ dataType: 'File', validation })
      expect(result.isValid).toBe(false)
      expect(result.errors.map((e) => e.code)).toEqual(['rule_not_applicable'])
    }
    expect(structure({ dataType: 'Number', validation: { maxLength: 3 } }).isValid).toBe(false)
    expect(structure({ dataType: 'List', refValueType: 'Number', validation: { pattern: '^1' } }).isValid).toBe(false)
  })

  it('accepts them on Text, Html and Lists of those, and enum on any type', () => {
    expect(structure({ dataType: 'Text', validation: { maxLength: 20, pattern: '^a' } }).isValid).toBe(true)
    expect(structure({ dataType: 'Html', validation: { minLength: 1 } }).isValid).toBe(true)
    expect(structure({ dataType: 'List', refValueType: 'Text', validation: { maxLength: 5 } }).isValid).toBe(true)
    expect(structure({ dataType: 'Number', validation: { enum: [1, 2] } }).isValid).toBe(true)
  })

  it('names an unknown type', () => {
    const result = structure({ dataType: 'blob' })
    expect(result.isValid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('unknown_data_type')
  })
})

describe('validateProperty unknown types', () => {
  const validate = (properties: Record<string, any>, propertyName: string) =>
    service.validateProperty({ models: { Post: { properties } } } as any, 'Post', propertyName)

  it('rejects a type name that is not a data type', () => {
    expect(normalizeDataType('blob')).toBe('Blob')
    for (const type of ['blob', 'Blob', 'string-ish']) {
      const result = validate({ body: { type } }, 'body')
      expect(result.isValid).toBe(false)
      expect(result.errors.map((e) => e.code)).toEqual(['unknown_data_type'])
    }
  })

  it('rejects an unknown List element type', () => {
    const result = validate({ tags: { type: 'List', refValueType: 'blob' } }, 'tags')
    expect(result.errors.map((e) => e.code)).toEqual(['unknown_data_type'])
  })

  it('accepts the JSON Schema "string" name and any case', () => {
    expect(validate({ title: { type: 'string' } }, 'title').isValid).toBe(true)
    expect(validate({ title: { type: 'html' } }, 'title').isValid).toBe(true)
  })

  it('rejects length rules on a non-string type in the definition', () => {
    const result = validate({ attachment: { type: 'File', validation: { maxLength: 20 } } }, 'attachment')
    expect(result.errors.map((e) => e.code)).toEqual(['rule_not_applicable'])
  })
})
