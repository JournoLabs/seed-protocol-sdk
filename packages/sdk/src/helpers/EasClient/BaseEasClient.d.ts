import { GraphQLClient } from 'graphql-request';
import { Attestation } from '@/graphql/gql/graphql';
export declare abstract class BaseEasClient {
    static PlatformClass: typeof BaseEasClient;
    protected static easClient: GraphQLClient;
    static setPlatformClass(platformClass: typeof BaseEasClient): void;
    static getEasClient(): GraphQLClient;
    static getSeedsBySchemaName(schemaName: string): Promise<Attestation[]>;
}
//# sourceMappingURL=BaseEasClient.d.ts.map