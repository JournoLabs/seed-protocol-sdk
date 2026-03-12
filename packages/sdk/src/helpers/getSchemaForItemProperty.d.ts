import { Schema as EASSchema } from '@/graphql/gql/graphql';
import type { EIP712MessageTypes } from '@ethereum-attestation-service/eas-sdk';
type ExtractTypedData<T> = T extends {
    [key: string]: infer U;
} ? U extends Array<infer V> ? V : never : never;
type TypedData = ExtractTypedData<EIP712MessageTypes>;
type GetSchemaForPropertyProps = {
    schemaUid?: string;
    propertyName: string;
    easDataType?: TypedData['type'];
};
type GetSchemaForProperty = (props: GetSchemaForPropertyProps) => Promise<EASSchema | void>;
export declare const getEasSchemaForItemProperty: GetSchemaForProperty;
export {};
//# sourceMappingURL=getSchemaForItemProperty.d.ts.map