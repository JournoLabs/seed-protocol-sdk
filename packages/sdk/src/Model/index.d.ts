export { Model } from './Model';
export type { ModelMachineContext } from './service/modelMachine';
export declare const TModelValues: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TAny>;
export declare const TModelSchema: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    _dbId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    name: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    dataType: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Text>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Number>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.List>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Relation>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Image>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Json>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.File>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Boolean>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Date>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Html>]>;
    ref: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    modelId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TNumber, import("@sinclair/typebox").TString]>>;
    modelName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    refModelId: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TNumber>;
    refModelName: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    refValueType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Text>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Number>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.List>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Relation>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Image>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Json>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.File>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Boolean>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Date>, import("@sinclair/typebox").TLiteral<import("..").ModelPropertyDataTypes.Html>]>>;
    storageType: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"ItemStorage">, import("@sinclair/typebox").TLiteral<"PropertyStorage">]>>;
    localStorageDir: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    filenameSuffix: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    validation: import("@sinclair/typebox").TOptionalFromMappedResult<any, true>;
}>>;
//# sourceMappingURL=index.d.ts.map