import { ModelPropertyDataTypes } from '@/helpers/property';
import { ValidationResult, ValidationRules } from '@/Schema/validation';
import { SchemaMachineContext } from '../schemaMachine';
import { ModelPropertyMachineContext } from '@/ModelProperty/service/modelPropertyMachine';
import { ModelMachineContext } from '@/Model/service/modelMachine';
/**
 * Service for validating schemas, models, and properties using TypeBox
 */
export declare class SchemaValidationService {
    /**
     * Enhance TypeBox error message with expected values for union/literal types
     */
    private enhanceErrorMessage;
    /**
     * Extract expected values from a schema for a given field path
     */
    private extractExpectedValues;
    /**
     * Extract literal value from a schema
     */
    private extractLiteralValue;
    /**
     * Get the schema for a specific field path
     */
    private getSchemaForField;
    /**
     * Validate a property structure against TProperty schema
     */
    validatePropertyStructure(property: ModelPropertyMachineContext): ValidationResult;
    /**
     * Validate a property value against its validation rules
     */
    validatePropertyValue(value: any, dataType: ModelPropertyDataTypes, validationRules?: ValidationRules, refValueType?: ModelPropertyDataTypes | string): ValidationResult;
    /**
     * Validate a specific property within a schema
     */
    validateProperty(schema: SchemaMachineContext, modelName: string, propertyName: string, propertyData?: ModelPropertyMachineContext): ValidationResult;
    /**
     * Validate model structure (basic structure checks)
     */
    validateModelStructure(model: ModelMachineContext & {
        properties?: {
            [key: string]: any;
        };
    }): ValidationResult;
    /**
     * Validate a model against a schema WITHOUT requiring it to be in the schema's context
     * This allows validation before registration, preventing update loops
     */
    validateModelAgainstSchema(schema: SchemaMachineContext, modelName: string, modelData: ModelMachineContext & {
        properties?: {
            [key: string]: any;
        };
    }): ValidationResult;
    /**
     * Validate a model within a schema (requires model to already be in schema context)
     */
    validateModel(schema: SchemaMachineContext, modelName: string, modelData?: ModelMachineContext): ValidationResult;
    /**
     * Validate entire schema
     */
    validateSchema(schema: SchemaMachineContext): ValidationResult;
    /**
     * Get base TypeBox schema for a data type
     */
    private getBaseSchemaForDataType;
    /**
     * Apply validation rules to a TypeBox schema
     */
    private applyValidationRules;
    /**
     * Validate custom validation rules
     */
    private validateCustomRules;
}
//# sourceMappingURL=SchemaValidationService.d.ts.map