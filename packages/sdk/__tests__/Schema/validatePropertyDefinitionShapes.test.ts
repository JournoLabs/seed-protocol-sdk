import { describe, it, expect } from 'vitest'
import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'

// Schema context definitions arrive in two shapes: schema-file ({ type, model }) and runtime
// ({ dataType, ref }, e.g. models added from Model instances). Requiring `type` made validation reject
// every edit to a runtime-shaped property, so ModelProperty changes were silently never persisted.
describe('SchemaValidationService.validateProperty definition shapes', () => {
  const service = new SchemaValidationService()
  const validate = (properties: Record<string, any>, propertyName: string) =>
    service.validateProperty({ models: { Post: { properties }, Author: { properties: {} } } } as any, 'Post', propertyName)

  it('accepts a schema-file definition ({ type })', () => {
    expect(validate({ title: { type: 'Text' } }, 'title').isValid).toBe(true)
  })

  it('accepts a runtime definition ({ dataType })', () => {
    const result = validate({ title: { dataType: 'Text', schemaFileId: 'abc' } }, 'title')
    expect(result.errors).toEqual([])
    expect(result.isValid).toBe(true)
  })

  it('still rejects a definition with neither type nor dataType', () => {
    const result = validate({ title: { schemaFileId: 'abc' } }, 'title')
    expect(result.isValid).toBe(false)
    expect(result.errors.map((e) => e.code)).toContain('missing_type')
  })

  it('checks the related model for Relation in either shape', () => {
    expect(validate({ author: { type: 'Relation', model: 'Author' } }, 'author').isValid).toBe(true)
    expect(validate({ author: { dataType: 'Relation', ref: 'Author' } }, 'author').isValid).toBe(true)

    const missing = validate({ author: { dataType: 'Relation' } }, 'author')
    expect(missing.errors.map((e) => e.code)).toContain('missing_ref')

    const unknown = validate({ author: { dataType: 'Relation', ref: 'Nope' } }, 'author')
    expect(unknown.errors.map((e) => e.code)).toContain('invalid_reference')
  })
})
