type SetSchemaUidForSchemaDefinitionProps = {
    text: string;
    schemaUid: string;
};
type SetSchemaUidForSchemaDefinition = (props: SetSchemaUidForSchemaDefinitionProps) => void;
export declare const setSchemaUidForSchemaDefinition: SetSchemaUidForSchemaDefinition;
type SetSchemaUidForModelProps = {
    modelName: string;
    schemaUid: string;
};
export declare const setSchemaUidForModel: ({ modelName, schemaUid }: SetSchemaUidForModelProps) => void;
export declare const getSchemaUidForModelFromCache: (modelName: string) => string | undefined;
type GetSchemaUidForSchemaDefinitionProps = {
    schemaText: string;
};
type GetSchemaUidForSchemaDefinition = (props: GetSchemaUidForSchemaDefinitionProps) => Promise<string | undefined>;
export declare const getEasSchemaUidForSchemaDefinition: GetSchemaUidForSchemaDefinition;
export declare const fetchSchemaUids: () => Promise<void>;
export {};
//# sourceMappingURL=eas.d.ts.map