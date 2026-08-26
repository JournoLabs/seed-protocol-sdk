import { GraphQLClient } from 'graphql-request';
import type { Attestation } from '@seedprotocol/eas';
export declare abstract class BaseEasClient {
    static PlatformClass: typeof BaseEasClient;
    protected static easClient: GraphQLClient;
    static setPlatformClass(platformClass: typeof BaseEasClient): void;
    static getEasClient(): GraphQLClient;
    static getSeedsBySchemaName(schemaName: string): Promise<Attestation[]>;
}
//# sourceMappingURL=BaseEasClient.d.ts.map