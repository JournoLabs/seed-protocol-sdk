import type { IQueryClient } from './IQueryClient.js';
import type { IQueryClientFactory } from './IQueryClientFactory.js';
export declare abstract class BaseQueryClient {
    private static _impl;
    static configure(impl: IQueryClientFactory): void;
    private static requireImpl;
    static getQueryClient(): IQueryClient;
}
