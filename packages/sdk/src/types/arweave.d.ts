import type { CreateTransactionInterface } from 'arweave/web';
/**
 * Status response from Arweave transaction status endpoint
 */
export type TransactionStatus = {
    status: number;
    confirmed: {
        block_height: number;
        block_indep_hash: string;
        number_of_confirmations: number;
    } | null;
};
/**
 * Transaction tag (name-value pair)
 */
export type TransactionTag = {
    name: string;
    value: string;
};
/**
 * Options for fetching transaction data
 */
export type GetDataOptions = {
    decode?: boolean;
    string?: boolean;
};
/**
 * Parameters for bulk file download operations
 */
export type DownloadFilesParams = {
    transactionIds: string[];
    excludedTransactions?: Set<string>;
};
/**
 * Result of a file download operation
 */
export type DownloadResult = {
    transactionId: string;
    success: boolean;
    contentType?: string;
    data?: Uint8Array | string;
    error?: string;
};
/**
 * Arweave transaction interface (from arweave package)
 */
export type ArweaveTransaction = Awaited<ReturnType<{
    createTransaction(attributes: Partial<CreateTransactionInterface>): Promise<any>;
}['createTransaction']>>;
/**
 * Options for creating a transaction
 */
export type CreateTransactionOptions = {
    tags?: TransactionTag[];
};
//# sourceMappingURL=arweave.d.ts.map