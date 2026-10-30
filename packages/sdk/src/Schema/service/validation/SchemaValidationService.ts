import { Value, ValueErrorType } from '@sinclair/typebox/value'
import { TProperty } from '@/Schema'
import {
  ModelPropertyDataTypes,
  TPropertyDataType,
  isDataType,
  isKnownDataType,
  normalizeDataType,
  validationRuleProblems,
} from '@/helpers/property'
import { ValidationResult, ValidationError, ValidationRules, DEFAULT_TEXT_MAX_LENGTH } from '@/Schema/validation'
import { SchemaMachineContext } from '../schemaMachine'
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine'
import { ModelMachineContext } from '@/Model/service/modelMachine'
import { FormatRegistry, Type, TSchema, TUnion, TLiteral } from '@sinclair/typebox'
import debug from 'debug'

const logger = debug('seedSdk:schema:validation')

/** Codes for TypeBox's error kinds that have their own; every other kind is a wrong type. */
const VALUE_ERROR_CODES: Partial<Record<ValueErrorType, string>> = {
  [ValueErrorType.StringPattern]: 'pattern',
  [ValueErrorType.StringMinLength]: 'min_length',
  [ValueErrorType.StringMaxLength]: 'max_length_exceeded',
  [ValueErrorType.StringFormat]: 'format',
  [ValueErrorType.StringFormatUnknown]: 'format',
  [ValueErrorType.ObjectRequiredProperty]: 'required',
  [ValueErrorType.ObjectAdditionalProperties]: 'unknown_field',
  [ValueErrorType.NumberMinimum]: 'minimum',
  [ValueErrorType.NumberExclusiveMinimum]: 'minimum',
  [ValueErrorType.IntegerMinimum]: 'minimum',
  [ValueErrorType.IntegerExclusiveMinimum]: 'minimum',
  [ValueErrorType.NumberMaximum]: 'maximum',
  [ValueErrorType.NumberExclusiveMaximum]: 'maximum',
  [ValueErrorType.IntegerMaximum]: 'maximum',
  [ValueErrorType.IntegerExclusiveMaximum]: 'maximum',
}

/** The named code for a TypeBox error kind (TypeBox's own are numbers). */
const valueErrorCode = (type: ValueErrorType): string => VALUE_ERROR_CODES[type] ?? 'type'

// Date properties use Type.String({ format: 'date-time' }). TypeBox only checks formats that are
// registered, and fails every value for an unknown one, so without this no Date value was valid.
if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (value) => !Number.isNaN(Date.parse(value)))
}

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
  private extractLiteralValue(schema: TSchema, _fieldPath: string): any {
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
      // Normalize dataType and refValueType for case-insensitive schema support (e.g. "relation" -> "Relation")
      const normalized = { ...property }
      if (typeof normalized.dataType === 'string') {
        normalized.dataType = normalizeDataType(normalized.dataType) as any
      }
      if (typeof normalized.refValueType === 'string') {
        normalized.refValueType = normalizeDataType(normalized.refValueType) as any
      }
      const isValid = Value.Check(TProperty, normalized)
      
      const errors: ValidationError[] = []
      
      if (!isValid) {
        const typeBoxErrors = [...Value.Errors(TProperty, normalized)]
        errors.push(...typeBoxErrors.map(err => {
          const fieldPath = err.path || 'unknown'
          const fieldSchema = this.getSchemaForField(TProperty, fieldPath)
          const enhancedMessage = this.enhanceErrorMessage(err, fieldSchema || TProperty, fieldPath)
          
          const isTypeName = fieldPath === '/dataType' || fieldPath === '/refValueType'
          return {
            field: fieldPath,
            message: enhancedMessage,
            code: isTypeName && err.type === ValueErrorType.Union ? 'unknown_data_type' : valueErrorCode(err.type),
            severity: 'error' as const,
          }
        }))
      }

      const warnings: ValidationError[] = []
      for (const problem of validationRuleProblems(normalized.dataType, normalized.refValueType, normalized.validation)) {
        ;(problem.severity === 'warning' ? warnings : errors).push(problem)
      }

      // Non-List types: refValueType is only valid for Relation+Image (related entity type). Reject otherwise.
      const nonListTypes = [
        ModelPropertyDataTypes.Text,
        ModelPropertyDataTypes.Number,
        ModelPropertyDataTypes.Boolean,
        ModelPropertyDataTypes.Date,
        ModelPropertyDataTypes.Json,
        ModelPropertyDataTypes.Image,
        ModelPropertyDataTypes.File,
        ModelPropertyDataTypes.Html,
        ModelPropertyDataTypes.Relation,
      ]
      if (nonListTypes.includes(normalized.dataType as ModelPropertyDataTypes)) {
        const hasRefValueType = normalized.refValueType != null && String(normalized.refValueType).trim() !== ''
        if (hasRefValueType) {
          // Relation may keep refValueType only for Image (relation to Image entity)
          if (normalized.dataType === ModelPropertyDataTypes.Relation && normalized.refValueType === ModelPropertyDataTypes.Image) {
            // Allowed: Relation to Image
          } else {
            errors.push({
              field: 'refValueType',
              message: `refValueType is only valid for List properties. Use dataType 'List' with refValueType '${normalized.refValueType}' for lists of ${normalized.refValueType}.`,
              code: 'invalid_ref_value_type',
              severity: 'error' as const,
            })
          }
        }
      }

      // List: refValueType is required
      if (normalized.dataType === ModelPropertyDataTypes.List) {
        const hasRefValueType = normalized.refValueType != null && String(normalized.refValueType).trim() !== ''
        if (!hasRefValueType) {
          errors.push({
            field: 'refValueType',
            message: `List properties require refValueType (e.g. 'Text', 'Number', 'Relation') to specify the element type.`,
            code: 'missing_ref_value_type',
            severity: 'error' as const,
          })
        }
        // List of relations: ref is required
        if (hasRefValueType && normalized.refValueType === ModelPropertyDataTypes.Relation) {
          const hasRef = normalized.ref && normalized.ref.trim() !== ''
          const hasRefModelName = normalized.refModelName && normalized.refModelName.trim() !== ''
          const hasRefModelId = normalized.refModelId !== undefined && normalized.refModelId !== null
          if (!hasRef && !hasRefModelName && !hasRefModelId) {
            errors.push({
              field: 'ref',
              message: `List properties with refValueType 'Relation' require either a "ref", "refModelName", or "refModelId" field to be defined`,
              code: 'missing_ref',
              severity: 'error' as const,
            })
          }
        }
      }

      // Relation (single): ref is required
      if (normalized.dataType === ModelPropertyDataTypes.Relation) {
        const hasRef = normalized.ref && normalized.ref.trim() !== ''
        const hasRefModelName = normalized.refModelName && normalized.refModelName.trim() !== ''
        const hasRefModelId = normalized.refModelId !== undefined && normalized.refModelId !== null
        if (!hasRef && !hasRefModelName && !hasRefModelId) {
          errors.push({
            field: 'ref',
            message: `Property with dataType "Relation" requires either a "ref", "refModelName", or "refModelId" field to be defined`,
            code: 'missing_ref',
            severity: 'error' as const,
          })
        }
        if ((hasRef || hasRefModelName) && !hasRefModelId) {
          logger(`Property "${normalized.name}" has ref/refModelName but no refModelId - will be resolved asynchronously`)
        }
      }
      
      return {
        isValid: errors.length === 0,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
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
   * @param value - The value to validate
   * @param dataType - The property's data type
   * @param validationRules - Optional validation rules (enum, pattern, minLength, maxLength)
   * @param refValueType - For List properties: the element type (Text, Number, etc.). When set, each array element is validated against this type + validationRules.
   */
  validatePropertyValue(
    value: any,
    dataType: ModelPropertyDataTypes,
    validationRules?: ValidationRules,
    refValueType?: ModelPropertyDataTypes | string
  ): ValidationResult {
    dataType = normalizeDataType(dataType) as ModelPropertyDataTypes
    const errors: ValidationError[] = []
    const warnings: ValidationError[] = []

    try {
      // Array values are only allowed for List properties
      if (dataType !== ModelPropertyDataTypes.List && Array.isArray(value)) {
        errors.push({
          field: 'value',
          message: 'Array values are only allowed for List properties. Use dataType "List" with refValueType to store multiple values.',
          code: 'array_not_allowed',
          severity: 'error' as const,
        })
      }

      // File/Image: accept File objects from OS picker, and Blobs for Image (saveImage persists both).
      // The TypeBox schema only allows string|null.
      const isFileObject = typeof File !== 'undefined' && value instanceof File
      const isBlobObject = typeof Blob !== 'undefined' && value instanceof Blob
      if (
        (dataType === ModelPropertyDataTypes.File && isFileObject) ||
        (dataType === ModelPropertyDataTypes.Image && isBlobObject)
      ) {
        return {
          isValid: errors.length === 0,
          errors,
          warnings: warnings.length > 0 ? warnings : undefined,
        }
      }

      // List with refValueType: validate each element against element schema + validation rules
      if (dataType === ModelPropertyDataTypes.List && refValueType && Array.isArray(value)) {
        const elementDataType = normalizeDataType(String(refValueType)) as ModelPropertyDataTypes
        // Apply default maxLength for Text elements in List. Html elements hold arbitrary-length content.
        const elementEffectiveRules = validationRules ? { ...validationRules } : {}
        if (
          elementDataType === ModelPropertyDataTypes.Text &&
          elementEffectiveRules.maxLength === undefined &&
          !(Array.isArray(elementEffectiveRules.enum) && elementEffectiveRules.enum.length > 0)
        ) {
          elementEffectiveRules.maxLength = DEFAULT_TEXT_MAX_LENGTH
        }
        for (let i = 0; i < value.length; i++) {
          const elementResult = this.validatePropertyValue(
            value[i],
            elementDataType,
            elementEffectiveRules
          )
          for (const err of elementResult.errors) {
            errors.push({
              field: `value[${i}]`,
              message: `Element at index ${i}: ${err.message}`,
              code: err.code,
              severity: err.severity,
            })
          }
        }
        return {
          isValid: errors.length === 0,
          errors,
          warnings: warnings.length > 0 ? warnings : undefined,
        }
      }

      // List without refValueType or non-array: validate as scalar/array
      if (dataType === ModelPropertyDataTypes.List && !Array.isArray(value) && value != null) {
        errors.push({
          field: 'value',
          message: 'List properties require an array value.',
          code: 'array_required',
          severity: 'error' as const,
        })
        return { isValid: false, errors }
      }

      // Build base TypeBox schema from dataType
      let schema: TSchema = this.getBaseSchemaForDataType(dataType)

      // Apply default maxLength for Text when not explicitly set. Html holds arbitrary-length content (e.g. article body) and must not default to 255.
      const effectiveRules = validationRules ? { ...validationRules } : {}
      // An enum already bounds the value, so the default limit is not added to it.
      const hasEnum = !!(effectiveRules.enum && Array.isArray(effectiveRules.enum) && effectiveRules.enum.length > 0)
      if (dataType === ModelPropertyDataTypes.Text && effectiveRules.maxLength === undefined && !hasEnum) {
        effectiveRules.maxLength = DEFAULT_TEXT_MAX_LENGTH
      }

      // Apply validation rules; enum is checked on its own below, so a miss is one problem
      if (Object.keys(effectiveRules).length > 0) {
        schema = this.applyValidationRules(schema, dataType, effectiveRules)
      }

      // Validate using TypeBox
      if (!Value.Check(schema, value)) {
        const isDefaultTextLimit =
          dataType === ModelPropertyDataTypes.Text &&
          effectiveRules.maxLength === DEFAULT_TEXT_MAX_LENGTH &&
          validationRules?.maxLength === undefined
        const typeLabel = dataType === ModelPropertyDataTypes.Html ? 'Html' : 'Text'
        for (const err of Value.Errors(schema, value)) {
          const fieldPath = err.path || 'value'
          const code = valueErrorCode(err.type)
          let message: string
          if (code === 'max_length_exceeded') {
            message = isDefaultTextLimit
              ? `Text properties have a default limit of ${DEFAULT_TEXT_MAX_LENGTH} characters. Set validation.maxLength for a higher limit, or use an Html property for long content.`
              : `${typeLabel} must be ${effectiveRules.maxLength} characters or less.`
          } else if (code === 'min_length') {
            message = `${typeLabel} must be at least ${effectiveRules.minLength} characters.`
          } else if (code === 'pattern') {
            message = `${typeLabel} must match the pattern ${effectiveRules.pattern}. Received: ${JSON.stringify(value)}`
          } else {
            message = this.enhanceErrorMessage(err, schema, fieldPath)
          }
          errors.push({ field: fieldPath, message, code, severity: 'error' as const })
        }
      }

      if (hasEnum && !effectiveRules.enum!.includes(value)) {
        errors.push({
          field: 'value',
          message: `Expected one of: ${effectiveRules.enum!.map((v) => JSON.stringify(v)).join(', ')}. Received: ${JSON.stringify(value)}`,
          code: 'enum_violation',
          severity: 'error' as const,
        })
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
    
    if (!propertyDefinition && propertyData?._originalValues?.name) {
      const originalName = propertyData._originalValues.name
      // If the current name differs from the original, check if original exists
      if (originalName !== propertyName && model.properties?.[originalName]) {
        propertyDefinition = model.properties[originalName]
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

    // Schema context definitions come in two shapes: schema-file ({ type, model }) and runtime
    // ({ dataType, ref/refModelName }, e.g. models added from Model instances). Accept both, as the
    // List check below already does; requiring `type` rejected every edit to a runtime-shaped property.
    const definitionType = propertyDefinition.type ?? (propertyDefinition as any).dataType
    const definitionRefModel: string | undefined =
      propertyDefinition.model ?? (propertyDefinition as any).ref ?? (propertyDefinition as any).refModelName

    // Validate property definition structure
    if (!definitionType) {
      errors.push({
        field: 'property.type',
        message: 'Property type is required',
        code: 'missing_type',
        severity: 'error' as const,
      })
    } else if (!isKnownDataType(definitionType)) {
      errors.push({
        field: 'property.type',
        message: `Unknown property type "${definitionType}". Expected one of: ${Object.values(ModelPropertyDataTypes).join(', ')}`,
        code: 'unknown_data_type',
        severity: 'error' as const,
      })
    }

    // Validate Relation: requires model
    if (isDataType(definitionType, ModelPropertyDataTypes.Relation)) {
      if (!definitionRefModel || definitionRefModel.trim() === '') {
        errors.push({
          field: 'property.model',
          message: `Property with type "Relation" requires a "model" field to be defined`,
          code: 'missing_ref',
          severity: 'error' as const,
        })
      } else if (!schema.models[definitionRefModel]) {
        errors.push({
          field: 'property.model',
          message: `Referenced model "${definitionRefModel}" not found in schema`,
          code: 'invalid_reference',
          severity: 'error' as const,
        })
      }
    }

    // Validate List: requires refValueType; ref (model) required only when refValueType === 'Relation' (case-insensitive)
    if (isDataType(propertyDefinition.type, ModelPropertyDataTypes.List) || isDataType((propertyDefinition as any).dataType, ModelPropertyDataTypes.List)) {
      const rawRefValueType = (propertyDefinition as any).refValueType ?? (propertyDefinition as any).items?.type ?? (propertyDefinition as any).refvaluetype
      const refValueType = rawRefValueType ? normalizeDataType(String(rawRefValueType)) : undefined
      if (!refValueType || String(refValueType).trim() === '') {
        errors.push({
          field: 'property.refValueType',
          message: 'List properties require "refValueType" (e.g. refValueType: "Text" or refValueType: "Relation" with ref: "Tag")',
          code: 'missing_ref_value_type',
          severity: 'error' as const,
        })
      } else if (!isKnownDataType(refValueType)) {
        errors.push({
          field: 'property.refValueType',
          message: `Unknown refValueType "${rawRefValueType}". Expected one of: ${Object.values(ModelPropertyDataTypes).join(', ')}`,
          code: 'unknown_data_type',
          severity: 'error' as const,
        })
      } else if (refValueType === 'Relation' || refValueType === 'RelationProperty') {
        const model = (propertyDefinition as any).ref ?? (propertyDefinition as any).model ?? (propertyDefinition as any).items?.model
        if (!model || String(model).trim() === '') {
          errors.push({
            field: 'property.ref',
            message: 'List of relations requires "ref" to specify the related model',
            code: 'missing_ref',
            severity: 'error' as const,
          })
        } else if (schema.models && !schema.models[model]) {
          errors.push({
            field: 'property.ref',
            message: `Referenced model "${model}" not found in schema`,
            code: 'invalid_reference',
            severity: 'error' as const,
          })
        }
      }
    }

    // The structure check above covers the rules when propertyData is given
    if (!propertyData && definitionType) {
      const definition = propertyDefinition as {
        refValueType?: string
        items?: { type?: string }
        validation?: Record<string, unknown>
      }
      const definitionRefValueType = definition.refValueType ?? definition.items?.type
      for (const problem of validationRuleProblems(definitionType, definitionRefValueType, definition.validation)) {
        if (problem.severity === 'error') errors.push({ ...problem, field: `property.${problem.field}` })
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
    model: ModelMachineContext & { properties?: { [key: string]: any } }
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
    modelData: ModelMachineContext & { properties?: { [key: string]: any } }
  ): ValidationResult {

    // Create a temporary schema context that includes this model for validation purposes
    // This allows validateProperty to work without actually adding the model to the real schema
    const tempSchemaContext: SchemaMachineContext = {
      ...schema,
      models: {
        ...schema.models,
        [modelName]: {
          properties: modelData.properties || {},
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
    _modelData?: ModelMachineContext
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

    // Validate all properties in the model
    if (model.properties) {
      for (const propertyName of Object.keys(model.properties)) {
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
   * Apply the string rules to a TypeBox schema. For Text and Html, pattern, minLength and
   * maxLength combine into one string schema. (Each rule used to replace the schema built so far,
   * so e.g. Text's default maxLength silently dropped any pattern.) Enum is checked separately.
   */
  private applyValidationRules(
    schema: TSchema,
    dataType: ModelPropertyDataTypes,
    rules: ValidationRules
  ): TSchema {
    let result = schema

    if (dataType === ModelPropertyDataTypes.Text || dataType === ModelPropertyDataTypes.Html) {
      const options: { pattern?: string; minLength?: number; maxLength?: number } = {}
      if (rules.pattern) {
        try {
          new RegExp(rules.pattern)
          options.pattern = rules.pattern
        } catch (error) {
          logger('Invalid regex pattern:', rules.pattern, error)
        }
      }
      if (rules.minLength !== undefined) options.minLength = rules.minLength
      if (rules.maxLength !== undefined) options.maxLength = rules.maxLength
      if (Object.keys(options).length > 0) {
        result = Type.String(options)
      }
    }

    return result
  }
}
