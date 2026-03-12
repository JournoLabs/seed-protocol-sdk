/**
 * Validation rules that can be applied to properties
 * Matches the ValidationRules definition in protocol/schema.json
 */
export type ValidationRules = {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    enum?: any[];
    custom?: string;
    [key: string]: any;
};
/**
 * TypeBox schema for ValidationRules
 */
export declare const TValidationRules: import("@sinclair/typebox").TObject<{
    pattern: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    minLength: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    maxLength: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    enum: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TAny>>;
    custom: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
/**
 * Validation error structure
 */
export type ValidationError = {
    field: string;
    message: string;
    code: string;
    severity: 'error' | 'warning';
};
/**
 * Validation result
 */
export type ValidationResult = {
    isValid: boolean;
    errors: ValidationError[];
    warnings?: ValidationError[];
};
//# sourceMappingURL=validation.d.ts.map