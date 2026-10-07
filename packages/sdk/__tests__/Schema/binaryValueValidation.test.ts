import { describe, it, expect } from 'vitest'
import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { ModelPropertyDataTypes } from '@/helpers/property'

// saveImage persists File, Blob, data URL and blob URL values, so validation must not reject them first.
describe('binary value validation for Image/File properties', () => {
  const schema = new SchemaValidationService()
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

  it('accepts a Blob for an Image property', () => {
    const result = schema.validatePropertyValue(blob, ModelPropertyDataTypes.Image)
    expect(result.errors).toEqual([])
    expect(result.isValid).toBe(true)
  })

  it('accepts a File for an Image property', () => {
    const file = new File([blob], 'a.png', { type: 'image/png' })
    expect(schema.validatePropertyValue(file, ModelPropertyDataTypes.Image).isValid).toBe(true)
  })

  it('accepts a File for a File property', () => {
    const file = new File([blob], 'a.txt', { type: 'text/plain' })
    expect(schema.validatePropertyValue(file, ModelPropertyDataTypes.File).isValid).toBe(true)
  })

  it('still rejects a plain object for an Image property', () => {
    expect(schema.validatePropertyValue({}, ModelPropertyDataTypes.Image).isValid).toBe(false)
  })
})
