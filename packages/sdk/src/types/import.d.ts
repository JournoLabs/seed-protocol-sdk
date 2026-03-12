/**
 * Import JSON schema format (input)
 */
export type JsonImportSchema = {
    name: string;
    models: {
        [modelName: string]: {
            description?: string;
            properties: {
                [propertyName: string]: {
                    type: string;
                    required?: boolean;
                    description?: string;
                    storage?: {
                        type: string;
                        path?: string;
                        extension?: string;
                    };
                    validation?: {
                        pattern?: string;
                        [key: string]: any;
                    };
                    model?: string;
                    accessor?: string;
                    refValueType?: string;
                    ref?: string;
                    /** @deprecated Use refValueType and ref instead */
                    items?: {
                        type: string;
                        model?: string;
                        [key: string]: any;
                    };
                    [key: string]: any;
                };
            };
            indexes?: string[];
        };
    };
};
/**
 * Full schema file format (output)
 */
export type SchemaFileFormat = {
    $schema: string;
    version: number;
    id?: string;
    metadata: {
        name: string;
        createdAt: string;
        updatedAt: string;
    };
    models: {
        [modelName: string]: {
            id?: string;
            description?: string;
            properties: {
                [propertyName: string]: {
                    id?: string;
                    [key: string]: any;
                };
            };
            indexes?: string[];
        };
    };
    enums: {
        [enumName: string]: any;
    };
    migrations: Array<{
        version: number;
        timestamp: string;
        description: string;
        changes: any[];
    }>;
};
//# sourceMappingURL=import.d.ts.map