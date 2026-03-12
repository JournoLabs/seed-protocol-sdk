import { ModelProperty } from '@/ModelProperty/ModelProperty';
/**
 * Convert Model.properties array to object format (for backward compatibility)
 * This replaces the old model.schema getter
 */
export declare function modelPropertiesToObject(properties: ModelProperty[]): {
    [propertyName: string]: any;
};
//# sourceMappingURL=model.d.ts.map