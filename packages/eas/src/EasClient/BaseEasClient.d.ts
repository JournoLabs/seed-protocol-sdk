import type { Attestation } from '../graphql/gql/graphql.js';
import { GraphQLClient } from 'graphql-request';
import type { IEasClient } from './IEasClient.js';
export declare abstract class BaseEasClient {
    private static _impl;
    static configure(impl: IEasClient): void;
    private static requireImpl;
    static getEasClient(): GraphQLClient;
    static getSeedsBySchemaName(schemaName: string): Promise<Attestation[]>;
}
export { BaseEasClient as EasClient };
