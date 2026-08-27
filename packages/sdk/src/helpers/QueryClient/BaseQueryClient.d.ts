import type { IQueryClient } from "@/interfaces/IQueryClient";
export declare abstract class BaseQueryClient {
    private static _impl;
    static configure(impl: import('@seedprotocol/eas').IQueryClientFactory): void;
    static getQueryClient(): IQueryClient;
}
