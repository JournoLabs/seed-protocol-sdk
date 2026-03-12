import { GetCorrectId } from '@/types/helpers';
export * from './ArweaveClient/BaseArweaveClient';
export * from './EasClient/BaseEasClient';
export * from './QueryClient/BaseQueryClient';
export * from './FileManager/BaseFileManager';
export { waitForEntityIdle } from './waitForEntityIdle';
export * from './publishConfig';
export declare const generateId: () => string;
export declare const toSnakeCase: (str: string) => string;
export declare const identifyString: (str: string) => "json" | "text" | "base64" | "html" | "markdown" | undefined;
export declare const getMimeType: (base64: string) => string | null;
export declare const getCorrectId: GetCorrectId;
export declare const getDataTypeFromString: (data: string) => "imageBase64" | "base64" | "url" | null;
export declare const convertTxIdToImage: (txId: string) => Promise<string | undefined>;
/**
 * Constructs an Arweave URL for a storage transaction ID
 * @param storageTransactionId - The Arweave transaction ID
 * @returns The full URL to access the transaction data on Arweave (e.g., https://arweave.net/raw/{transactionId})
 * @deprecated Use BaseArweaveClient.getRawUrl() instead for better consistency and testability
 */
export declare const getArweaveUrlForTransaction: (storageTransactionId: string) => string;
export declare const getExecutionTime: (task: (...args: any[]) => Promise<any>, args: any[]) => Promise<number>;
export declare const capitalizeFirstLetter: (string: string) => string;
export declare const parseEasRelationPropertyName: (easPropertyName: string) => {
    propertyName: string;
    modelName: string;
    isList: boolean;
};
export declare const isBinary: (arrayBuffer: ArrayBuffer) => boolean;
//# sourceMappingURL=index.d.ts.map