import { Attestation, Schema as EASSchema } from "@/graphql/gql/graphql";
type GetModelSchemasFromEas = () => Promise<EASSchema[]>;
export declare const getModelSchemasFromEas: GetModelSchemasFromEas;
type GetItemVersionsFromEasProps = {
    seedUids: string[];
};
type GetItemVersionsFromEas = (props: GetItemVersionsFromEasProps) => Promise<Attestation[]>;
export declare const getItemVersionsFromEas: GetItemVersionsFromEas;
type GetItemPropertiesFromEasProps = {
    versionUids: string[];
};
type GetItemPropertiesFromEas = (props: GetItemPropertiesFromEasProps) => Promise<Attestation[]>;
export declare const getItemPropertiesFromEas: GetItemPropertiesFromEas;
type GetSchemaUidBySchemaNameProps = {
    schemaName: string;
};
type GetSchemaUidBySchemaName = (props: GetSchemaUidBySchemaNameProps) => Promise<string | undefined>;
export declare const getEasSchemaUidBySchemaName: GetSchemaUidBySchemaName;
export declare const getSeedsFromSchemaUids: ({ schemaUids, addresses }: {
    schemaUids: string[];
    addresses: string[];
}) => Promise<any>;
export declare const getSeedsBySchemaName: (schemaName: string, limit?: number) => Promise<any>;
export declare const getSeedUidsBySchemaName: (schemaName: string, limit?: number) => Promise<any>;
export {};
//# sourceMappingURL=eas.d.ts.map