import { Value } from '@sinclair/typebox/value'
import { TProperty } from '@/Schema'
import { ModelPropertyDataTypes, TPropertyDataType } from '@/helpers/property'
import { ValidationResult, ValidationError, ValidationRules } from '@/Schema/validation'
import { SchemaMachineContext } from '../schemaMachine'
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine'
import { ModelMachineContext } from '@/Model/service/modelMachine'
import { Type, TSchema, TUnion, TLiteral } from '@sinclair/typebox'
import debug from 'debug'

const logger = debug('seedSdk:schema:validation')

/**
 * Service for validating schemas, models, and properties using TypeBox
 */
export class SchemaValidationService {
  /**
   * Enhance TypeBox error message with expected values for union/literal types
   */
  private enhanceErrorMessage(
    error: any,
    schema: TSchema,
    fieldPath: string
  ): string {
    const originalMessage = error.message || 'Validation failed'
    
    // Handle Union type errors (like TPropertyDataType)
    if (error.type === 'Union' || originalMessage.includes('union')) {
      const expectedValues = this.extractExpectedValues(schema, fieldPath)
      if (expectedValues.length > 0) {
        return `Expected one of: ${expectedValues.join(', ')}. Received: ${JSON.stringify(error.value)}`
      }
    }
    
    // Handle Literal type errors
    if (error.type === 'Literal') {
      const expectedValue = this.extractLiteralValue(schema, fieldPath)
      if (expectedValue !== undefined) {
        return `Expected: ${JSON.stringify(expectedValue)}. Received: ${JSON.stringify(error.value)}`
      }
    }
    
    // Return enhanced message with value info if available
    if (error.value !== undefined) {
      return `${originalMessage}. Received: ${JSON.stringify(error.value)}`
    }
    
    return originalMessage
  }

  /**
   * Extract expected values from a schema for a given field path
   */
  private extractExpectedValues(schema: TSchema | null, fieldPath: string): string[] {
    try {
      // Handle TProperty schema - check if this is the dataType field
      if (fieldPath === '/dataType' || fieldPath.endsWith('/dataType')) {
        // Return all ModelPropertyDataTypes enum values
        return Object.values(ModelPropertyDataTypes) as string[]
      }
      
      // Handle TStorageType
      if (fieldPath === '/storageType' || fieldPath.endsWith('/storageType')) {
        return ['ItemStorage', 'PropertyStorage']
      }
      
      // If we have a schema, try to extract from it
      if (!schema) {
        return []
      }
      
      // Try to extract from TypeBox Union type using the schema directly
      const schemaObj = schema as any
      const kind = schemaObj[Symbol.for('TypeBox.Kind')]
      
      if (kind === 'Union') {
        const union = schemaObj as TUnion<any>
        const anyOf = union.anyOf || []
        const values: string[] = []
        
        for (const item of anyOf) {
          const itemKind = item?.[Symbol.for('TypeBox.Kind')]
          if (itemKind === 'Literal') {
            const literal = item as TLiteral<any>
            if (literal.const !== undefined) {
              values.push(String(literal.const))
            }
          }
        }
        
        if (values.length > 0) {
          return values
        }
      }
      
      // Fallback: try to extract from JSON schema format
      if (typeof schema === 'object' && 'anyOf' in schema) {
        const union = schema as any
        if (Array.isArray(union.anyOf)) {
          return union.anyOf
            .map((item: any) => {
              if (item.const !== undefined) return String(item.const)
              if (item.enum && Array.isArray(item.enum)) return item.enum.map(String)
              return null
            })
            .filter((val: any) => val !== null)
            .flat()
            .map(String)
        }
      }
    } catch (error) {
      logger('Error extracting expected values:', error)
    }
    
    return []
  }

  /**
   * Extract literal value from a schema
   */
  private extractLiteralValue(schema: TSchema, fieldPath: string): any {
    try {
      if (schema && typeof schema === 'object') {
        const schemaObj = schema as any
        if (schemaObj[Symbol.for('TypeBox.Kind')] === 'Literal') {
          return (schemaObj as TLiteral<any>).const
        }
        if (schemaObj.const !== undefined) {
          return schemaObj.const
        }
      }
    } catch (error) {
      logger('Error extracting literal value:', error)
    }
    
    return undefined
  }

  /**
   * Get the schema for a specific field path
   */
  private getSchemaForField(schema: TSchema, fieldPath: string): TSchema | null {
    try {
      if (!schema || typeof schema !== 'object') return null
      
      // Remove leading slash
      const path = fieldPath.replace(/^\//, '')
      if (!path) return schema
      
      const schemaObj = schema as any
      const kind = schemaObj[Symbol.for('TypeBox.Kind')]
      
      // For TProperty (Object type), check properties
      if (kind === 'Object') {
        const properties = schemaObj.properties
        if (properties && properties[path]) {
          return properties[path]
        }
      }
      
      // Special handling for known fields - return the actual schema
      if (path === 'dataType') {
        return TPropertyDataType as TSchema
      }
      
      // Fallback: check if schema has the property
      if (path in schemaObj) {
        return schemaObj[path]
      }
    } catch (error) {
      logger('Error getting schema for field:', error)
    }
    
    return null
  }

  /**
   * Validate a property structure against TProperty schema
   */
  validatePropertyStructure(
    property: ModelPropertyMachineContext
  ): ValidationResult {
    try {
      const isValid = Value.Check(TProperty, property)
      
      const errors: ValidationError[] = []
      
      if (!isValid) {
        const typeBoxErrors = [...Value.Errors(TProperty, property)]
        errors.push(...typeBoxErrors.map(err => {
          const fieldPath = err.path || 'unknown'
          const fieldSchema = this.getSchemaForField(TProperty, fieldPath)
          const enhancedMessage = this.enhanceErrorMessage(err, fieldSchema || TProperty, fieldPath)
          
          return {
            field: fieldPath,
            message: enhancedMessage,
            code: err.type || 'validation_error',
            severity: 'error' as const,
          }
        }))
      }
      
      // Validate that Relation and List properties have a ref defined
      if (property.dataType === ModelPropertyDataTypes.Relation || property.dataType === ModelPropertyDataTypes.List) {
        if (!property.ref || property.ref.trim() === '') {
          errors.push({
            field: 'ref',
            message: `Property with dataType "${property.dataType}" requires a "ref" field to be defined`,
            code: 'missing_ref',
            severity: 'error' as const,
          })
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors,
      }
    } catch (error) {
      logger('Error validating property structure:', error)
      return {
        isValid: false,
        errors: [{
          field: 'property',
          message: error instanceof Error ? error.message : 'Unknown validation error',
          code: 'validation_exception',
          severity: 'error' as const,
        }],
      }
    }
  }

  /**
   * Validate a property value against its validation rules
   */
  validatePropertyValue(
    value: any,
    dataType: ModelPropertyDataTypes,
    validationRules?: ValidationRules
  ): ValidationResult {
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []

    try {
      // Build base TypeBox schema from dataType
      let schema: TSchema = this.getBaseSchemaForDataType(dataType)

      // Apply validation rules
      if (validationRules) {
        schema = this.applyValidationRules(schema, dataType, validationRules)
      }

      // Validate using TypeBox
      const isValid = Value.Check(schema, value)
      
      if (!isValid) {
        const typeBoxErrors = [...Value.Errors(schema, value)]
        errors.push(...typeBoxErrors.map(err => {
          const fieldPath = err.path || 'value'
          const enhancedMessage = this.enhanceErrorMessage(err, schema, fieldPath)
          
          return {
            field: fieldPath,
            message: enhancedMessage,
            code: err.type || 'value_validation_error',
            severity: 'error' as const,
          }
        }))
      }

      // Additional custom validations
      if (validationRules) {
        const customErrors = this.validateCustomRules(value, validationRules)
        errors.push(...customErrors)
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    } catch (error) {
      logger('Error validating property value:', error)
      return {
        isValid: false,
        errors: [{
          field: 'value',
          message: error instanceof Error ? error.message : 'Unknown validation error',
          code: 'validation_exception',
          severity: 'error' as const,
        }],
      }
    }
  }

  /**
   * Validate a specific property within a schema
   */
  validateProperty(
    schema: SchemaMachineContext,
    modelName: string,
    propertyName: string,
    propertyData?: ModelPropertyMachineContext
  ): ValidationResult {
    const errors: ValidationError[] = []

    // Check if model exists
    if (!schema.models || !schema.models[modelName]) {
      errors.push({
        field: 'model',
        message: `Model "${modelName}" not found in schema`,
        code: 'model_not_found',
        severity: 'error' as const,
      })
      return { isValid: false, errors }
    }

    const model = schema.models[modelName]

    // Check if property exists in model
    // If the property name has changed (renamed), check if the original name exists
    let propertyDefinition = model.properties?.[propertyName]
    let actualPropertyName = propertyName
    
    if (!propertyDefinition && propertyData?._originalValues?.name) {
      const originalName = propertyData._originalValues.name
      // If the current name differs from the original, check if original exists
      if (originalName !== propertyName && model.properties?.[originalName]) {
        propertyDefinition = model.properties[originalName]
        actualPropertyName = originalName
        // Property is being renamed, which is allowed - continue validation
      }
    }
    
    if (!propertyDefinition) {
      errors.push({
        field: 'property',
        message: `Property "${propertyName}" not found in model "${modelName}"`,
        code: 'property_not_found',
        severity: 'error' as const,
      })
      return { isValid: false, errors }
    }

    // If propertyData is provided, validate its structure
    if (propertyData) {
      const structureResult = this.validatePropertyStructure(propertyData)
      errors.push(...structureResult.errors)
    }

    // Validate property definition structure
    if (!propertyDefinition.type) {
      errors.push({
        field: 'property.type',
        message: 'Property type is required',
        code: 'missing_type',
        severity: 'error' as const,
      })
    }

    // Validate Relation and List properties have a ref/model defined
    if (propertyDefinition.type === 'Relation' || propertyDefinition.type === 'List') {
      if (!propertyDefinition.model || propertyDefinition.model.trim() === '') {
        errors.push({
          field: 'property.model',
          message: `Property with type "${propertyDefinition.type}" requires a "model" field to be defined`,
          code: 'missing_ref',
          severity: 'error' as const,
        })
      } else if (!schema.models[propertyDefinition.model]) {
        errors.push({
          field: 'property.model',
          message: `Referenced model "${propertyDefinition.model}" not found in schema`,
          code: 'invalid_reference',
          severity: 'error' as const,
        })
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Validate model structure (basic structure checks)
   */
  validateModelStructure(
    model: ModelMachineContext
  ): ValidationResult {
    const errors: ValidationError[] = []

    // Validate model name
    if (!model.modelName || model.modelName.trim() === '') {
      errors.push({
        field: 'modelName',
        message: 'Model name is required',
        code: 'missing_model_name',
        severity: 'error' as const,
      })
    }

    // Validate schema name
    if (!model.schemaName || model.schemaName.trim() === '') {
      errors.push({
        field: 'schemaName',
        message: 'Schema name is required',
        code: 'missing_schema_name',
        severity: 'error' as const,
      })
    }

    // Validate properties is an object
    if (model.properties && typeof model.properties !== 'object') {
      errors.push({
        field: 'properties',
        message: 'Properties must be an object',
        code: 'invalid_properties',
        severity: 'error' as const,
      })
    }

    // Validate indexes is an array if provided
    if (model.indexes !== undefined && !Array.isArray(model.indexes)) {
      errors.push({
        field: 'indexes',
        message: 'Indexes must be an array',
        code: 'invalid_indexes',
        severity: 'error' as const,
      })
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Validate a model against a schema WITHOUT requiring it to be in the schema's context
   * This allows validation before registration, preventing update loops
   */
  validateModelAgainstSchema(
    schema: SchemaMachineContext,
    modelName: string,
    modelData: ModelMachineContext
  ): ValidationResult {
    const errors: ValidationError[] = []

    // Create a temporary schema context that includes this model for validation purposes
    // This allows validateProperty to work without actually adding the model to the real schema
    const tempSchemaContext: SchemaMachineContext = {
      ...schema,
      models: {
        ...schema.models,
        [modelName]: {
          description: modelData.description,
          properties: modelData.properties || {},
          indexes: modelData.indexes || [],
        },
      },
    }

    // Use validateModel which now works because the model is in the temp context
    return this.validateModel(tempSchemaContext, modelName, modelData)
  }

  /**
   * Validate a model within a schema (requires model to already be in schema context)
   */
  validateModel(
    schema: SchemaMachineContext,
    modelName: string,
    modelData?: ModelMachineContext
  ): ValidationResult {
    const errors: ValidationError[] = []

    if (!schema.models || !schema.models[modelName]) {
      errors.push({
        field: 'model',
        message: `Model "${modelName}" not found in schema`,
        code: 'model_not_found',
        severity: 'error' as const,
      })
      return { isValid: false, errors }
    }

    const model = schema.models[modelName]

    // Validate indexes reference existing properties
    if (model.indexes) {
      for (const indexField of model.indexes) {
        if (!model.properties || !model.properties[indexField]) {
          errors.push({
            field: `model.indexes[${indexField}]`,
            message: `Index field "${indexField}" does not exist in model "${modelName}"`,
            code: 'invalid_index',
            severity: 'error' as const,
          })
        }
      }
    }

    // Validate all properties in the model
    if (model.properties) {
      for (const [propertyName, propertyDef] of Object.entries(model.properties)) {
        const propertyResult = this.validateProperty(schema, modelName, propertyName)
        if (!propertyResult.isValid) {
          errors.push(...propertyResult.errors.map(err => ({
            ...err,
            field: `${modelName}.${propertyName}.${err.field}`,
          })))
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Validate entire schema
   */
  validateSchema(schema: SchemaMachineContext): ValidationResult {
    const errors: ValidationError[] = []

    // Validate schema name
    if (!schema.schemaName || schema.schemaName.trim() === '') {
      errors.push({
        field: 'schemaName',
        message: 'Schema name is required',
        code: 'missing_schema_name',
        severity: 'error' as const,
      })
    }

    // Validate metadata
    if (!schema.metadata) {
      errors.push({
        field: 'metadata',
        message: 'Schema metadata is required',
        code: 'missing_metadata',
        severity: 'error' as const,
      })
    } else {
      if (!schema.metadata.name || schema.metadata.name.trim() === '') {
        errors.push({
          field: 'metadata.name',
          message: 'Schema metadata name is required',
          code: 'missing_metadata_name',
          severity: 'error' as const,
        })
      }
    }

    // Validate models if they exist
    if (schema.models && Object.keys(schema.models).length > 0) {
      // Validate each model
      for (const modelName of Object.keys(schema.models)) {
        const modelResult = this.validateModel(schema, modelName)
        if (!modelResult.isValid) {
          errors.push(...modelResult.errors)
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }

  /**
   * Get base TypeBox schema for a data type
   */
  private getBaseSchemaForDataType(dataType: ModelPropertyDataTypes): TSchema {
    switch (dataType) {
      case ModelPropertyDataTypes.Text:
      case ModelPropertyDataTypes.Html:
        return Type.String()
      case ModelPropertyDataTypes.Number:
        return Type.Number()
      case ModelPropertyDataTypes.Boolean:
        return Type.Boolean()
      case ModelPropertyDataTypes.Date:
        return Type.String({ format: 'date-time' })
      case ModelPropertyDataTypes.Json:
        return Type.Any()
      case ModelPropertyDataTypes.List:
        return Type.Array(Type.Any())
      case ModelPropertyDataTypes.Relation:
      case ModelPropertyDataTypes.Image:
      case ModelPropertyDataTypes.File:
        return Type.Union([Type.String(), Type.Null()])
      default:
        return Type.Any()
    }
  }

  /**
   * Apply validation rules to a TypeBox schema
   */
  private applyValidationRules(
    schema: TSchema,
    dataType: ModelPropertyDataTypes,
    rules: ValidationRules
  ): TSchema {
    let result = schema

    // Apply pattern (regex) for strings
    if (rules.pattern && (dataType === ModelPropertyDataTypes.Text || dataType === ModelPropertyDataTypes.Html)) {
      try {
        const regex = new RegExp(rules.pattern)
        result = Type.RegEx(regex)
      } catch (error) {
        logger('Invalid regex pattern:', rules.pattern, error)
      }
    }

    // Apply minLength/maxLength for strings
    if (dataType === ModelPropertyDataTypes.Text || dataType === ModelPropertyDataTypes.Html) {
      const stringSchema = Type.String()
      if (rules.minLength !== undefined) {
        result = Type.String({ minLength: rules.minLength })
      }
      if (rules.maxLength !== undefined) {
        if (rules.minLength !== undefined) {
          result = Type.String({ minLength: rules.minLength, maxLength: rules.maxLength })
        } else {
          result = Type.String({ maxLength: rules.maxLength })
        }
      }
    }

    // Apply enum
    if (rules.enum && Array.isArray(rules.enum) && rules.enum.length > 0) {
      result = Type.Union(rules.enum.map(val => Type.Literal(val)))
    }

    return result
  }

  /**
   * Validate custom validation rules
   */
  private validateCustomRules(
    value: any,
    rules: ValidationRules
  ): ValidationError[] {
    const errors: ValidationError[] = []

    // Custom validator reference (would need to be implemented based on your needs)
    if (rules.custom) {
      // TODO: Implement custom validator lookup and execution
      logger('Custom validator not yet implemented:', rules.custom)
    }

    return errors
  }
}

