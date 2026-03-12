import { Type, TSchema } from '@sinclair/typebox'
import { ModelPropertyDataTypes } from '@/helpers/property'

/** Default maximum length for Text and Html properties when not explicitly set */
export const DEFAULT_TEXT_MAX_LENGTH = 255

/**
 * Validation rules that can be applied to properties
 * Matches the ValidationRules definition in protocol/schema.json
 */
export type ValidationRules = {
  pattern?: string
  minLength?: number
  maxLength?: number
  enum?: any[]
  custom?: string
  [key: string]: any
}

/**
 * TypeBox schema for ValidationRules
 */
export const TValidationRules = Type.Object({
  pattern: Type.Optional(Type.String()),
  minLength: Type.Optional(Type.Integer({ minimum: 0 })),
  maxLength: Type.Optional(Type.Integer({ minimum: 1 })),
  enum: Type.Optional(Type.Array(Type.Any())),
  custom: Type.Optional(Type.String()),
}, { additionalProperties: true })

/**
 * Validation error structure
 */
export type ValidationError = {
  field: string
  message: string
  code: string
  severity: 'error' | 'warning'
}

/**
 * Validation result
 */
export type ValidationResult = {
  isValid: boolean
  errors: ValidationError[]
  warnings?: ValidationError[]
}

