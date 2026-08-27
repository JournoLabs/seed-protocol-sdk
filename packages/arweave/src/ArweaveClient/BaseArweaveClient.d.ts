import { GraphQLClient } from 'graphql-request';
import type { TransactionStatus, TransactionTag, GetDataOptions, DownloadFilesParams, DownloadResult, CreateTransactionOptions } from '../types/arweave.js';
import type { IArweaveClient } from './IArweaveClient.js';
export declare abstract class BaseArweaveClient {
    private static _impl;
    static configure(impl: IArweaveClient): void;
    private static requireImpl;
    static resolveGateway(): {
        protocol: 'http' | 'https';
        host: string;
    };
    static getHost(): string;
    static getProtocol(): 'http' | 'https';
    static getBaseUrl(): string;
    static setHost(host: string): void;
    static isReadGatewayLocked(): boolean;
    static resetReadGatewaySelectionStateForTests(): void;
    static setPreferredReadGateway(host: string): void;
    static applyProbedReadGateway(host: string): void;
    static getEndpoint(): string;
    static getRawUrl(transactionId: string): string;
    static getStatusUrl(transactionId: string): string;
    static getArweaveClient(): GraphQLClient;
    static getTransactionStatus(transactionId: string): Promise<TransactionStatus>;
    static getTransactionData(transactionId: string, options?: GetDataOptions): Promise<Uint8Array | string>;
    static getTransactionTags(transactionId: string): Promise<TransactionTag[]>;
    static createTransaction(data: string | Uint8Array, options?: CreateTransactionOptions): Promise<any>;
    static downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]>;
}
