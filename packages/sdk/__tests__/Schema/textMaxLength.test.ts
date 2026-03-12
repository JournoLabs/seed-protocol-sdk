import { describe, it, expect } from 'vitest'
import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { ModelPropertyDataTypes } from '@/helpers/property'
import { DEFAULT_TEXT_MAX_LENGTH } from '@/Schema/validation'

describe('Text maxLength validation', () => {
  const schema = new SchemaValidationService()

  describe('default 255 limit for Text', () => {
    it('rejects Text with 256 chars when no validation rules', () => {
      const value = 'a'.repeat(256)
      const result = schema.validatePropertyValue(value, ModelPropertyDataTypes.Text)
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.message.includes('255'))).toBe(true)
      expect(result.errors.some((e) => e.message.includes('File property'))).toBe(true)
    })

    it('accepts Text with 255 chars', () => {
      const value = 'a'.repeat(255)
      const result = schema.validatePropertyValue(value, ModelPropertyDataTypes.Text)
      expect(result.isValid).toBe(true)
    })

    it('accepts Text with fewer than 255 chars', () => {
      const result = schema.validatePropertyValue('hello', ModelPropertyDataTypes.Text)
      expect(result.isValid).toBe(true)
    })
  })

  describe('default 255 limit for Html', () => {
    it('rejects Html with 256 chars when no validation rules', () => {
      const value = '<p>' + 'a'.repeat(250) + '</p>'
      expect(value.length).toBeGreaterThan(255)
      const result = schema.validatePropertyValue(value, ModelPropertyDataTypes.Html)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('255'))).toBe(true)
      expect(result.errors.some((e) => e.message.includes('File property'))).toBe(true)
    })

    it('accepts Html with 255 chars', () => {
      const value = 'a'.repeat(255)
      const result = schema.validatePropertyValue(value, ModelPropertyDataTypes.Html)
      expect(result.isValid).toBe(true)
    })
  })

  describe('custom maxLength in validation rules', () => {
    it('accepts 256 chars when maxLength is 500', () => {
      const value = 'a'.repeat(256)
      const result = schema.validatePropertyValue(value, ModelPropertyDataTypes.Text, {
        maxLength: 500,
      })
      expect(result.isValid).toBe(true)
    })

    it('rejects 501 chars when maxLength is 500, with custom limit in message', () => {
      const value = 'a'.repeat(501)
      const result = schema.validatePropertyValue(value, ModelPropertyDataTypes.Text, {
        maxLength: 500,
      })
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('500'))).toBe(true)
      expect(result.errors.some((e) => e.message.includes('File property'))).toBe(true)
    })
  })

  describe('List of Text', () => {
    it('rejects List of Text when element exceeds 255 chars', () => {
      const value = ['short', 'a'.repeat(256)]
      const result = schema.validatePropertyValue(
        value,
        ModelPropertyDataTypes.List,
        undefined,
        'Text'
      )
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('Element at index 1'))).toBe(true)
      expect(result.errors.some((e) => e.message.includes('255'))).toBe(true)
    })

    it('accepts List of Text when all elements are 255 chars or less', () => {
      const value = ['short', 'a'.repeat(255)]
      const result = schema.validatePropertyValue(
        value,
        ModelPropertyDataTypes.List,
        undefined,
        'Text'
      )
      expect(result.isValid).toBe(true)
    })
  })

  describe('DEFAULT_TEXT_MAX_LENGTH constant', () => {
    it('exports DEFAULT_TEXT_MAX_LENGTH as 255', () => {
      expect(DEFAULT_TEXT_MAX_LENGTH).toBe(255)
    })
  })
})
